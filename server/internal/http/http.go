package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func HttpHello(c *gin.Context) {
	// This function name should be Capital uppercase
	// for other packages to call
	c.JSON(http.StatusOK, gin.H{
		"message": "hello http",
	})
}