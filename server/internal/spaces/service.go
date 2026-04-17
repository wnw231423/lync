package spaces

import (
	"errors"
	"fmt"
	"strings"
	"travel/internal/db"

	"gorm.io/gorm"
)

var ErrUserNotInSpace = errors.New("user is not a member of the specified space")

// EnsureBinding ensures user and space_member rows exist on the server.
// Space records are NOT created here — they will be created/updated by sync push.
func EnsureBinding(tx *gorm.DB, userID, spaceID string) error {
	user := db.User{}
	err := tx.Where("id = ?", userID).First(&user).Error
	switch {
	case err == nil:
	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := tx.Create(&db.User{ID: userID}).Error; err != nil {
			return err
		}
	default:
		return err
	}

	memberID := fmt.Sprintf("%s_%s", spaceID, userID)
	member := db.SpaceMember{}
	err = tx.Where("id = ?", memberID).First(&member).Error
	switch {
	case err == nil:
		return nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return tx.Create(&db.SpaceMember{
			ID:      memberID,
			SpaceID: spaceID,
			UserID:  userID,
		}).Error
	default:
		return err
	}
}

// EnsureUserInSpace 校验 user 是否属于 header space。
func EnsureUserInSpace(userID, headerSpaceID string) error {
	return EnsureUserInSpaceTx(db.DB, userID, headerSpaceID)
}

// EnsureUserInSpaceTx 在事务中校验 user 是否属于 header space。
func EnsureUserInSpaceTx(tx *gorm.DB, userID, headerSpaceID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(headerSpaceID) == "" {
		return gorm.ErrInvalidData
	}
	var count int64
	if err := tx.Model(&db.SpaceMember{}).
		Where("space_id = ? AND user_id = ?", headerSpaceID, userID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrUserNotInSpace
	}
	return nil
}

// ListUserSpaceIDs 查询某个 user 所属的全部 spaces。
func ListUserSpaceIDs(userID string) ([]string, error) {
	return ListUserSpaceIDsTx(db.DB, userID)
}

// ListUserSpaceIDsTx 在事务中查询某个 user 所属的全部 spaces。
func ListUserSpaceIDsTx(tx *gorm.DB, userID string) ([]string, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, gorm.ErrInvalidData
	}
	spaceIDs := make([]string, 0)
	if err := tx.Model(&db.SpaceMember{}).
		Where("user_id = ?", userID).
		Pluck("space_id", &spaceIDs).Error; err != nil {
		return nil, err
	}
	return spaceIDs, nil
}
