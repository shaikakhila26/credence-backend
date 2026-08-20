const STAGE_ORDER = [
  'kyc',
  'eligibility',
  'loan_terms',
  'bank_account',
  'declaration',
  'selfie',
  'under_review',
  'approved',
  'rejected',
  'disbursed',
  'closed',
];

const CUSTOMER_STAGES = [
  'kyc',
  'eligibility',
  'loan_terms',
  'bank_account',
  'declaration',
  'selfie',
];

function nextStage(current) {
  const idx =
    STAGE_ORDER.indexOf(
      current
    );

  if (
    idx === -1 ||
    idx ===
      STAGE_ORDER.length - 1
  ) {
    return current;
  }

  return STAGE_ORDER[
    idx + 1
  ];
}

function previousStage(current) {
  const idx =
    CUSTOMER_STAGES.indexOf(
      current
    );

  if (idx <= 0) {
    return null;
  }

  return CUSTOMER_STAGES[
    idx - 1
  ];
}

function progressFraction(current) {
  const idx =
    CUSTOMER_STAGES.indexOf(
      current
    );

  if (
    [
      'under_review',
      'approved',
      'rejected',
      'disbursed',
    ].includes(current)
  ) {
    return {
      completed:
        CUSTOMER_STAGES.length +
        1,

      total:
        CUSTOMER_STAGES.length +
        1,
    };
  }

  if (
    current === 'closed'
  ) {
    return {
      completed: 0,

      total:
        CUSTOMER_STAGES.length +
        1,
    };
  }

  return {
    completed:
      Math.max(idx, 0),

    total:
      CUSTOMER_STAGES.length +
      1,
  };
}

module.exports = {
  STAGE_ORDER,
  CUSTOMER_STAGES,
  nextStage,
  previousStage,
  progressFraction,
};