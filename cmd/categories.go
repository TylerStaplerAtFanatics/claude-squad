package cmd

// Standard command categories for organizing help display
const (
	CategorySession     Category = "Session Management"
	CategoryGit         Category = "Git Integration"
	CategoryNavigation  Category = "Navigation"
	CategoryOrganization Category = "Organization"
	CategorySystem      Category = "System"
	CategoryLegacy      Category = "Legacy"
	CategorySpecial     Category = "Special" // Hidden from main help
)

// CategoryOrder defines the display order for help screens
var CategoryOrder = []Category{
	CategorySession,
	CategoryGit,
	CategoryOrganization,
	CategoryNavigation,
	CategorySystem,
	CategoryLegacy,
}

// GetCategoryPriority returns the display priority for a category (lower = higher priority)
func GetCategoryPriority(category Category) int {
	for i, cat := range CategoryOrder {
		if cat == category {
			return i
		}
	}
	return len(CategoryOrder) // Unknown categories go to the end
}

// IsHiddenCategory returns true if the category should be hidden from main help
func IsHiddenCategory(category Category) bool {
	return category == CategorySpecial
}