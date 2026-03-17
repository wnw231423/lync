package main

import (
	// module name is travel
	// use other package within the module
	"travel/internal/http"
	"travel/internal/ws"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"time"
)

func main() {
	r := gin.Default()

	// 为了解决本地开发的CORS问题
    r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
        ExposeHeaders:    []string{"Content-Length"},
        AllowCredentials: true,
        MaxAge:           12 * time.Hour,
    }))

	r.GET("/hello", http.HttpHello)
	r.GET("/ws", ws.WsHello)
	
	r.Run(":8088")
}