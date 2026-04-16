package ws

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = pongWait * 9 / 10
	maxMessageSize = 8 * 1024
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	conn    *websocket.Conn
	spaceID string
	userID  string
	send    chan []byte
}

type roomState struct {
	clients              map[*Client]bool
	lastLocationByUserID map[string][]byte
}

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*roomState
}

var globalHub = &Hub{
	rooms: make(map[string]*roomState),
}

type BroadcastMessage struct {
	SpaceID   string `json:"space_id"`
	SenderID  string `json:"sender_id"`
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
}

type inboundSocketPayload struct {
	Type string `json:"type"`
}

type memberOfflinePayload struct {
	Type   string `json:"type"`
	UserID string `json:"user_id"`
	SentAt int64  `json:"sent_at"`
}

func (h *Hub) register(client *Client) [][]byte {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[client.spaceID]
	if !ok {
		room = &roomState{
			clients:              make(map[*Client]bool),
			lastLocationByUserID: make(map[string][]byte),
		}
		h.rooms[client.spaceID] = room
	}

	room.clients[client] = true

	snapshots := make([][]byte, 0, len(room.lastLocationByUserID))
	for userID, payload := range room.lastLocationByUserID {
		if userID == client.userID {
			continue
		}
		snapshots = append(snapshots, append([]byte(nil), payload...))
	}
	return snapshots
}

func (h *Hub) unregister(client *Client) []byte {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[client.spaceID]
	if !ok {
		return nil
	}

	delete(room.clients, client)
	delete(room.lastLocationByUserID, client.userID)

	if len(room.clients) == 0 {
		delete(h.rooms, client.spaceID)
		return nil
	}

	offlinePayload, err := json.Marshal(memberOfflinePayload{
		Type:   "member_offline",
		UserID: client.userID,
		SentAt: time.Now().UnixMilli(),
	})
	if err != nil {
		return nil
	}

	envelope, err := json.Marshal(BroadcastMessage{
		SpaceID:   client.spaceID,
		SenderID:  client.userID,
		Message:   string(offlinePayload),
		Timestamp: time.Now().UnixMilli(),
	})
	if err != nil {
		return nil
	}

	return envelope
}

func (h *Hub) rememberLocation(client *Client, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[client.spaceID]
	if !ok {
		return
	}

	room.lastLocationByUserID[client.userID] = append([]byte(nil), payload...)
}

func (h *Hub) broadcast(sender *Client, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room, ok := h.rooms[sender.spaceID]
	if !ok {
		return
	}

	for c := range room.clients {
		if c == sender {
			continue
		}
		select {
		case c.send <- payload:
		default:
			go func(slowClient *Client) {
				h.forceCloseClient(slowClient)
			}(c)
		}
	}
}

func (h *Hub) broadcastSystem(spaceID string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	room, ok := h.rooms[spaceID]
	if !ok {
		return
	}

	for c := range room.clients {
		select {
		case c.send <- payload:
		default:
			go func(slowClient *Client) {
				h.forceCloseClient(slowClient)
			}(c)
		}
	}
}

func (h *Hub) forceCloseClient(client *Client) {
	_ = client.conn.Close()
}

func WsSpace(c *gin.Context) {
	spaceID := c.Query("space_id")
	userID := c.Query("user_id")
	if spaceID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "space_id and user_id are required"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("failed to upgrade:", err)
		return
	}

	client := &Client{
		conn:    conn,
		spaceID: spaceID,
		userID:  userID,
		send:    make(chan []byte, 32),
	}

	snapshots := globalHub.register(client)
	defer func() {
		offlineEnvelope := globalHub.unregister(client)
		if offlineEnvelope != nil {
			globalHub.broadcastSystem(client.spaceID, offlineEnvelope)
		}
		close(client.send)
		_ = conn.Close()
	}()

	go writePump(client)

	for _, snapshot := range snapshots {
		select {
		case client.send <- snapshot:
		default:
			log.Printf("failed to replay cached location for space=%s user=%s", client.spaceID, client.userID)
		}
	}

	readPump(client)
}

func readPump(client *Client) {
	client.conn.SetReadLimit(maxMessageSize)
	_ = client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, message, err := client.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(
				err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
				websocket.CloseNoStatusReceived,
			) {
				log.Printf("ws disconnected unexpectedly: space=%s user=%s err=%v", client.spaceID, client.userID, err)
			}
			return
		}

		message = bytes.TrimSpace(message)
		if len(message) == 0 {
			continue
		}

		payload, err := json.Marshal(BroadcastMessage{
			SpaceID:   client.spaceID,
			SenderID:  client.userID,
			Message:   string(message),
			Timestamp: time.Now().UnixMilli(),
		})
		if err != nil {
			continue
		}

		if isLocationPayload(message) {
			globalHub.rememberLocation(client, payload)
		}

		globalHub.broadcast(client, payload)
	}
}

func writePump(client *Client) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-client.send:
			_ = client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = client.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func isLocationPayload(message []byte) bool {
	var payload inboundSocketPayload
	if err := json.Unmarshal(message, &payload); err != nil {
		return false
	}
	return payload.Type == "location"
}
