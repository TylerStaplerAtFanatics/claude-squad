package services

import (
	"testing"
)

func TestValidateLocalhostOrigin(t *testing.T) {
	tests := []struct {
		name          string
		peerAddr      string
		expectedError bool
	}{
		{
			name:          "Localhost IPv4",
			peerAddr:      "127.0.0.1:12345",
			expectedError: false,
		},
		{
			name:          "External IP",
			peerAddr:      "192.168.1.1:12345",
			expectedError: true,
		},
		{
			name:          "IPv6 Localhost",
			peerAddr:      "[::1]:12345",
			expectedError: false,
		},
		{
			name:          "Missing IP",
			peerAddr:      "",
			expectedError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateLocalhostAddr(tt.peerAddr)
			if (err != nil) != tt.expectedError {
				t.Errorf("validateLocalhostAddr(%q) error = %v, expectedError %v", tt.peerAddr, err, tt.expectedError)
			}
		})
	}
}
