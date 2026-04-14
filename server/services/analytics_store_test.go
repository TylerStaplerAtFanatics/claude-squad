package services

import "testing"

func TestClassify_DailyBucketAutoApproveRate(t *testing.T) {
	b := DailyBucket{
		Date:      "2026-04-13",
		AutoAllow: 8,
		AutoDeny:  1,
		Escalate:  1,
		Total:     10,
	}
	got := b.AutoApproveRate()
	if got != 0.8 {
		t.Errorf("AutoApproveRate() = %v, want 0.8", got)
	}

	empty := DailyBucket{}
	if empty.AutoApproveRate() != 0 {
		t.Errorf("AutoApproveRate() on zero bucket = %v, want 0", empty.AutoApproveRate())
	}
}
