package main

import (
	// module name is travel
	// use other package within the module
	"travel/internal/http"
	"travel/internal/ws"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	r.GET("/hello", http.HttpHello)
	r.GET("/ws", ws.WsHello)
	
	r.Run(":8080")
}