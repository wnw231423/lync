package ws

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// This function establishes a websocket connection from http
// then send back every message it received
func WsHello(c *gin.Context) {
	// This function name should be Capital uppercase
	// for other packages to call
	
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("failed to upgrade: ", err)
		return
	}
	defer conn.Close()

	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("disconnected: ", err)
			break
		}
		log.Printf("received: %s\n", message)

		err = conn.WriteMessage(messageType, message)
		if err != nil {
			log.Println("failed to send message: ", err)
			break
		}
	}
}