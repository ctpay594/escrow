const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface TransferFieldErrors {
  amount?: string;
  beneficiaryName?: string;
  accountNo?: string;
  ifsc?: string;
}

export function validateTransferFields(input: {
  amount: string;
  beneficiaryName?: string;
  accountNo: string;
  ifsc: string;
  availableBalance: number;
}): TransferFieldErrors {
  const errors: TransferFieldErrors = {};
  const parsedAmount = Number.parseFloat(input.amount);

  if (!input.amount.trim()) {
    errors.amount = 'Amount is required';
  } else if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    errors.amount = 'Enter a valid amount greater than zero';
  } else if (parsedAmount > input.availableBalance) {
    errors.amount = 'Amount exceeds your available balance';
  }

  const beneficiaryName = input.beneficiaryName?.trim() ?? '';
  if (input.beneficiaryName !== undefined) {
    if (!beneficiaryName) {
      errors.beneficiaryName = 'Beneficiary name is required';
    } else if (beneficiaryName.length < 2) {
      errors.beneficiaryName = 'Enter at least 2 characters';
    }
  }

  const account = input.accountNo.trim();
  if (!account) {
    errors.accountNo = 'Account number is required';
  } else if (!/^\d{9,18}$/.test(account)) {
    errors.accountNo = 'Enter a valid 9–18 digit account number';
  }

  const ifsc = input.ifsc.trim().toUpperCase();
  if (!ifsc) {
    errors.ifsc = 'IFSC is required';
  } else if (!IFSC_PATTERN.test(ifsc)) {
    errors.ifsc = 'Enter a valid IFSC (e.g. HDFC0001234)';
  }

  return errors;
}

export function isIfscValid(ifsc: string): boolean {
  return IFSC_PATTERN.test(ifsc.trim().toUpperCase());
}
