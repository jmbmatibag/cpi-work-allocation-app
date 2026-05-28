const OTP_KEY = "pending_otp";

export function sendMockOtp(email: string): void {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  sessionStorage.setItem(OTP_KEY, otp);
  console.log(`MOCK EMAIL SENT to ${email}: Your OTP is ${otp}`);
}

export function verifyOtp(entered: string): boolean {
  const stored = sessionStorage.getItem(OTP_KEY);
  if (!stored || stored !== entered.trim()) return false;
  sessionStorage.removeItem(OTP_KEY);
  return true;
}
