// Password policy, identical to the Cognito user pool policy in template.yaml.

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: p => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter (A–Z)', test: p => /[A-Z]/.test(p) },
  { id: 'number', label: 'One number (0–9)', test: p => /\d/.test(p) },
  { id: 'symbol', label: 'One special symbol (e.g. ! @ # $ %)', test: p => /[^A-Za-z0-9\s]/.test(p) },
];

export const isStrongPassword = (password: string) => PASSWORD_RULES.every(r => r.test(password));

/** 0–4: how many rules the password meets, for the strength meter. */
export const passwordScore = (password: string) => PASSWORD_RULES.filter(r => r.test(password)).length;

export const isValidPhone = (phone: string) => /^\+[1-9]\d{6,14}$/.test(phone);
