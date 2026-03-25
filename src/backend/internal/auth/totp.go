package auth

import (
	"github.com/pquerna/otp/totp"
)

func GenerateTOTPSecret(username string) (secret, qrURL string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Claude Proxy",
		AccountName: username,
	})
	if err != nil {
		return "", "", err
	}
	return key.Secret(), key.URL(), nil
}

func ValidateTOTPCode(secret, code string) bool {
	return totp.Validate(code, secret)
}
