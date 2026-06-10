export const MAIL_TEMPLATES = {
  PASSWORD_RESET_OTP: {
    subject: 'Password Reset OTP',
    text: (otp: string) => `Your OTP for password reset is: ${otp}. This OTP will expire in 10 minutes.`,
  },
} as const;

export const MAIL_SUBJECTS = {
  PASSWORD_RESET: 'Password Reset OTP',
} as const;
