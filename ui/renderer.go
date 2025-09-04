package ui

import (
	"claude-squad/log"
	"claude-squad/session"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/lipgloss"
)

// ɹ and ɻ are other options.
const branchIcon = "Ꮧ"
const tagIcon = "#"
const categoryIcon = "◆"

var highlightStyle = lipgloss.NewStyle().
	Background(lipgloss.Color("#FFFF00")).
	Foreground(lipgloss.Color("#000000"))

// InstanceRenderer handles rendering of session.Instance objects
type InstanceRenderer struct {
	spinner *spinner.Model
	width   int
}

func (r *InstanceRenderer) setWidth(width int) {
	r.width = AdjustPreviewWidth(width)
}

// RenderWithHighlights renders an instance with highlighted search results
func (r *InstanceRenderer) RenderWithHighlights(i *session.Instance, idx int, selected bool, hasMultipleRepos bool, matches []int) string {
	// Get title for highlighting separately
	titleText := i.Title
	
	// If no matches to highlight or empty title, use standard rendering
	if matches == nil || len(matches) == 0 || titleText == "" {
		return r.Render(i, idx, selected, hasMultipleRepos)
	}
	
	// Create a special version with highlighted title
	prefix := fmt.Sprintf(" %d. ", idx)
	if idx >= 10 {
		prefix = prefix[:len(prefix)-1]
	}
	
	titleS := selectedTitleStyle
	descS := selectedDescStyle
	if !selected {
		titleS = titleStyle
		descS = listDescStyle
	}
	
	// Handle status icon
	var join string
	switch i.Status {
	case session.Running:
		join = fmt.Sprintf("%s ", r.spinner.View())
	case session.Ready:
		join = readyStyle.Render(readyIcon)
	case session.Paused:
		join = pausedStyle.Render(pausedIcon)
	case session.NeedsApproval:
		join = needsApprovalStyle.Render(needsApprovalIcon)
	default:
	}
	
	// Create highlighted title by applying highlights to matching parts
	// Simplify by just highlighting first match in title
	highlightedTitle := titleText
	
	// Add category prefix if needed
	categoryPrefix := ""
	if i.Category != "" {
		categoryStyle := lipgloss.NewStyle().
			Foreground(lipgloss.AdaptiveColor{Light: "#000080", Dark: "#87CEFA"})
		categoryPrefix = categoryStyle.Render(categoryIcon + " ")
	}
	
	// Generate title with highlights
	widthAvail := r.width - 3 - len(prefix) - 1
	if len(titleText) > 0 && matches[0] < len(titleText) {
		// Simple approach: highlight first matching character
		pos := matches[0]
		if pos < len(titleText) {
			// Handle title truncation
			if widthAvail > 0 && widthAvail < len(titleText) && len(titleText) >= widthAvail-3 {
				if pos < widthAvail-3 {
					// Match is within visible part
					before := titleText[:pos]
					highlighted := highlightStyle.Render(string(titleText[pos]))
					after := ""
					if pos+1 < widthAvail-3 {
						after = titleText[pos+1:widthAvail-3]
					}
					highlightedTitle = before + highlighted + after + "..."
				} else {
					// Match is in truncated part, fall back to truncated title
					highlightedTitle = titleText[:widthAvail-3] + "..."
				}
			} else {
				// No truncation needed
				before := titleText[:pos]
				highlighted := highlightStyle.Render(string(titleText[pos]))
				after := ""
				if pos+1 < len(titleText) {
					after = titleText[pos+1:]
				}
				highlightedTitle = before + highlighted + after
			}
		}
	} else if widthAvail > 0 && widthAvail < len(titleText) && len(titleText) >= widthAvail-3 {
		// No matches in title but need truncation
		highlightedTitle = titleText[:widthAvail-3] + "..."
	}
	
	// Render title with highlighting
	title := titleS.Render(lipgloss.JoinHorizontal(
		lipgloss.Left,
		lipgloss.Place(r.width-3, 1, lipgloss.Left, lipgloss.Center, 
			fmt.Sprintf("%s%s%s", prefix, categoryPrefix, highlightedTitle)),
		" ",
		join,
	))
	
	// Rest of rendering is the same as regular Render
	renderedBase := r.Render(i, idx, selected, hasMultipleRepos)
	
	// Replace title line in base rendering
	lines := strings.Split(renderedBase, "\n")
	if len(lines) > 0 {
		lines[0] = title
		return strings.Join(lines, "\n")
	}
	
	return renderedBase
}

// Render renders an instance without highlights
func (r *InstanceRenderer) Render(i *session.Instance, idx int, selected bool, hasMultipleRepos bool) string {
	prefix := fmt.Sprintf(" %d. ", idx)
	if idx >= 10 {
		prefix = prefix[:len(prefix)-1]
	}
	titleS := selectedTitleStyle
	descS := selectedDescStyle
	if !selected {
		titleS = titleStyle
		descS = listDescStyle
	}

	// add spinner next to title if it's running
	var join string
	switch i.Status {
	case session.Running:
		join = fmt.Sprintf("%s ", r.spinner.View())
	case session.Ready:
		join = readyStyle.Render(readyIcon)
	case session.Paused:
		join = pausedStyle.Render(pausedIcon)
	case session.NeedsApproval:
		join = needsApprovalStyle.Render(needsApprovalIcon)
	default:
	}

	// Cut the title if it's too long
	titleText := i.Title
	widthAvail := r.width - 3 - len(prefix) - 1
	if widthAvail > 0 && widthAvail < len(titleText) && len(titleText) >= widthAvail-3 {
		titleText = titleText[:widthAvail-3] + "..."
	}
	
	// Add category icon if category exists
	categoryPrefix := ""
	if i.Category != "" {
		categoryStyle := lipgloss.NewStyle().
			Foreground(lipgloss.AdaptiveColor{Light: "#000080", Dark: "#87CEFA"})
		categoryPrefix = categoryStyle.Render(categoryIcon + " ")
	}
	
	title := titleS.Render(lipgloss.JoinHorizontal(
		lipgloss.Left,
		lipgloss.Place(r.width-3, 1, lipgloss.Left, lipgloss.Center, 
			fmt.Sprintf("%s%s%s", prefix, categoryPrefix, titleText)),
		" ",
		join,
	))

	stat := i.GetDiffStats()

	var diff string
	var addedDiff, removedDiff string
	if stat == nil || stat.Error != nil || stat.IsEmpty() {
		// Don't show diff stats if there's an error or if they don't exist
		addedDiff = ""
		removedDiff = ""
		diff = ""
	} else {
		addedDiff = fmt.Sprintf("+%d", stat.Added)
		removedDiff = fmt.Sprintf("-%d ", stat.Removed)
		diff = lipgloss.JoinHorizontal(
			lipgloss.Center,
			addedLinesStyle.Background(descS.GetBackground()).Render(addedDiff),
			lipgloss.Style{}.Background(descS.GetBackground()).Foreground(descS.GetForeground()).Render(","),
			removedLinesStyle.Background(descS.GetBackground()).Render(removedDiff),
		)
	}

	remainingWidth := r.width
	remainingWidth -= len(prefix)
	remainingWidth -= len(branchIcon)

	diffWidth := len(addedDiff) + len(removedDiff)
	if diffWidth > 0 {
		diffWidth += 1
	}

	// Use fixed width for diff stats to avoid layout issues
	remainingWidth -= diffWidth

	branch := i.Branch
	if i.Started() {
		// Skip repo name retrieval for paused instances
		if !i.Paused() {
			repoName, err := i.RepoName()
			if err != nil {
				// Log at warning level but don't break rendering
				log.WarningLog.Printf("could not get repo name in instance renderer: %v", err)
			} else {
				branch += fmt.Sprintf(" (%s)", repoName)
			}
		}
	}
	
	// Don't show branch if there's no space for it. Or show ellipsis if it's too long.
	if remainingWidth < 0 {
		branch = ""
	} else if remainingWidth < len(branch) {
		if remainingWidth < 3 {
			branch = ""
		} else {
			// We know the remainingWidth is at least 4 and branch is longer than that, so this is safe.
			branch = branch[:remainingWidth-3] + "..."
		}
	}
	remainingWidth -= len(branch)

	// Add spaces to fill the remaining width.
	spaces := ""
	if remainingWidth > 0 {
		spaces = strings.Repeat(" ", remainingWidth)
	}

	branchLine := fmt.Sprintf("%s %s-%s%s%s", strings.Repeat(" ", len(prefix)), branchIcon, branch, spaces, diff)
	
	// Add tags line if tags exist
	var tagsLine string
	if i.Tags != nil && len(i.Tags) > 0 {
		tagStyle := lipgloss.NewStyle().
			Foreground(lipgloss.AdaptiveColor{Light: "#888888", Dark: "#aaaaaa"})
		
		tagText := fmt.Sprintf("%s %s%s", 
			strings.Repeat(" ", len(prefix)),
			tagStyle.Render(tagIcon + " "),
			strings.Join(i.Tags, ", "),
		)
		
		// Truncate if too long
		if len(tagText) > r.width {
			tagText = tagText[:r.width-3] + "..."
		}
		
		tagsLine = descS.Render(tagText)
	}

	// Join all components
	var lines []string
	lines = append(lines, title, descS.Render(branchLine))
	if tagsLine != "" {
		lines = append(lines, tagsLine)
	}
	
	text := lipgloss.JoinVertical(lipgloss.Left, lines...)
	
	return text
}