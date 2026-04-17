package upload

import (
	"fmt"

	"github.com/gin-gonic/gin"
)

func baseURLFromRequest(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, c.Request.Host)
}
