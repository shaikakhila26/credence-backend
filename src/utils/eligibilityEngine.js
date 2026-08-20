/**
 * CREDENCE simulated underwriting / eligibility engine.
 *
 * This is a technical-challenge simulation, NOT a real credit-bureau decision.
 *
 * Base eligibility:
 * - Credit score
 * - Existing DTI
 * - Income borrowing capacity
 * - Requested amount
 *
 * Term eligibility:
 * - Existing debt
 * - New EMI
 * - Post-loan DTI
 * - Selected loan amount
 * - Selected tenure
 *
 * Demo policy:
 *
 * 750+       = Excellent
 * 650-749    = Good
 * 600-649    = Fair / Limited
 * <600       = Below minimum / Not eligible
 *
 * Existing DTI:
 * <=40%      = preferred
 * 40-50%     = reduced capacity
 * 50-60%     = further reduced capacity
 * >60%       = not eligible
 */

function creditBand(score) {
  const safeScore = Number(score) || 0;

  if (safeScore >= 750) {
    return {
      band: 'excellent',
      label: 'Excellent',
      multiple: 15,
    };
  }

  if (safeScore >= 650) {
    return {
      band: 'good',
      label: 'Good',
      multiple: 10,
    };
  }

  if (safeScore >= 600) {
    return {
      band: 'fair',
      label: 'Fair / limited',
      multiple: 6,
    };
  }

  return {
    band: 'poor',
    label: 'Below minimum',
    multiple: 0,
  };
}

function round2(value) {
  return (
    Math.round(
      Number(value || 0) * 100
    ) / 100
  );
}

function evaluateEligibility({
  monthlyIncome,
  requestedAmount,
  creditScore,
  existingDebts,
}) {
  const income = Math.max(
    Number(monthlyIncome) || 0,
    0
  );

  const requested = Math.max(
    Number(requestedAmount) || 0,
    0
  );

  const debts = Math.max(
    Number(existingDebts) || 0,
    0
  );

  const score = Math.max(
    Number(creditScore) || 0,
    0
  );

  /*
   * Existing DTI before the new loan.
   */
  const dtiRatio =
    income > 0
      ? (debts / income) * 100
      : 100;

  const credit = creditBand(score);

  /*
   * Base borrowing capacity based on income and credit band.
   */
  const baseEligibleAmount =
    income * credit.multiple;

  /*
   * Reduce borrowing capacity when existing debt is high.
   */
  let dtiPenaltyPercent = 0;

  if (dtiRatio > 50) {
    dtiPenaltyPercent = 30;
  } else if (dtiRatio > 40) {
    dtiPenaltyPercent = 15;
  }

  let maxEligibleAmount =
    baseEligibleAmount *
    (1 - dtiPenaltyPercent / 100);

  let result = 'not_eligible';

  /*
   * MANDATORY FAIL CONDITIONS
   *
   * A score below 600 can NEVER become eligible merely
   * because income or DTI is good.
   */
  if (income <= 0) {
    result = 'not_eligible';
    maxEligibleAmount = 0;
  } else if (score < 600) {
    result = 'not_eligible';
    maxEligibleAmount = 0;
  } else if (dtiRatio > 60) {
    result = 'not_eligible';
    maxEligibleAmount = 0;
  } else if (requested > maxEligibleAmount) {
    result = 'partially_eligible';
  } else if (score < 650) {
    /*
     * Fair/limited scores can receive a restricted offer,
     * but are not treated as full eligibility.
     */
    result = 'partially_eligible';
  } else {
    result = 'eligible';
  }

  const roundedDti =
    round2(dtiRatio);

  const roundedBase =
    round2(
      Math.max(
        baseEligibleAmount,
        0
      )
    );

  const roundedMax =
    round2(
      Math.max(
        maxEligibleAmount,
        0
      )
    );

  const factors = [
    {
      key: 'credit_score',
      label: 'Credit score',
      value: score,

      status:
        score >= 650
          ? 'good'
          : score >= 600
            ? 'warning'
            : 'bad',

      message:
        score >= 750
          ? 'Your simulated score is in the excellent range.'
          : score >= 650
            ? 'Your simulated score is in the good range.'
            : score >= 600
              ? 'Your simulated score is in the fair/limited range, so the offer may be restricted.'
              : 'Your simulated score is below the minimum 600 score used by this demo model.',
    },

    {
      key: 'dti',
      label: 'Debt-to-income ratio',
      value: roundedDti,
      suffix: '%',

      status:
        roundedDti <= 40
          ? 'good'
          : roundedDti <= 60
            ? 'warning'
            : 'bad',

      message:
        roundedDti <= 40
          ? 'Existing monthly debt is low relative to income.'
          : roundedDti <= 60
            ? 'Existing debt is meaningful and reduces borrowing capacity.'
            : 'Existing debt is above the maximum simulated DTI limit.',
    },

    {
      key: 'income_affordability',
      label:
        'Income vs requested amount',

      value: requested,

      status:
        roundedMax > 0 &&
        requested <= roundedMax
          ? 'good'
          : roundedMax > 0
            ? 'warning'
            : 'bad',

      message:
        roundedMax > 0 &&
        requested <= roundedMax
          ? 'The requested amount is within the calculated borrowing capacity.'
          : roundedMax > 0
            ? `The profile supports a lower amount of approximately ₹${roundedMax.toLocaleString('en-IN')}.`
            : 'The current financial profile does not support a loan offer.',
    },
  ];

  const reasons = [];

  if (score < 600) {
    reasons.push(
      'The simulated credit score is below the minimum 600 threshold used by this demo model.'
    );
  } else if (score < 650) {
    reasons.push(
      'The simulated credit score is in the fair/limited range, so the application is treated as partially eligible rather than fully eligible.'
    );
  } else {
    reasons.push(
      'The simulated credit score is within the acceptable range for a full offer.'
    );
  }

  if (roundedDti > 60) {
    reasons.push(
      'Existing monthly debt is above the 60% simulated DTI maximum.'
    );
  } else if (roundedDti > 40) {
    reasons.push(
      `Existing debt is ${roundedDti}% of income, so borrowing capacity is reduced by ${dtiPenaltyPercent}%.`
    );
  } else {
    reasons.push(
      `Existing debt is ${roundedDti}% of income, within the preferred 40% range.`
    );
  }

  if (roundedMax === 0) {
    reasons.push(
      'No eligible loan amount can be offered with the current inputs.'
    );
  } else if (requested > roundedMax) {
    reasons.push(
      `The requested amount is above the calculated maximum of ₹${roundedMax.toLocaleString('en-IN')}.`
    );
  } else {
    reasons.push(
      `The requested amount of ₹${Math.round(
        requested
      ).toLocaleString('en-IN')} is within the calculated borrowing capacity.`
    );
  }

  let summary;

  if (result === 'eligible') {
    summary =
      'Your income, simulated credit score and existing debt support the requested amount under this demo model.';
  } else if (
    result === 'partially_eligible'
  ) {
    summary =
      'Your profile supports a restricted offer. The final loan amount and tenure must still pass the affordability check based on the proposed EMI.';
  } else {
    summary =
      'Your current financial profile does not meet the demo model requirements for this requested loan.';
  }

  return {
    result,

    creditBand:
      credit.band,

    creditBandLabel:
      credit.label,

    debtToIncomeRatio:
      roundedDti,

    baseEligibleAmount:
      roundedBase,

    maxEligibleAmount:
      roundedMax,

    reasoning: {
      monthlyIncome:
        income,

      requestedAmount:
        requested,

      existingDebts:
        debts,

      creditScore:
        score,

      creditBand:
        credit.band,

      creditBandLabel:
        credit.label,

      incomeMultipleUsed:
        credit.multiple,

      baseEligibleAmount:
        roundedBase,

      dtiRatio:
        roundedDti,

      dtiPenaltyApplied:
        `${dtiPenaltyPercent}%`,

      maxEligibleAmount:
        roundedMax,

      factors,

      reasons,

      summary,
    },
  };
}

/**
 * Check affordability AFTER the customer selects
 * the actual amount and tenure.
 *
 * This is a separate underwriting layer.
 */
function evaluateTermEligibility({
  monthlyIncome,
  existingDebts,
  creditScore,
  requestedAmount,
  emi,
  baseMaxEligibleAmount,
}) {
  const income =
    Math.max(
      Number(monthlyIncome) || 0,
      0
    );

  const debts =
    Math.max(
      Number(existingDebts) || 0,
      0
    );

  const score =
    Math.max(
      Number(creditScore) || 0,
      0
    );

  const amount =
    Math.max(
      Number(requestedAmount) || 0,
      0
    );

  const monthlyEmi =
    Math.max(
      Number(emi) || 0,
      0
    );

  const totalMonthlyObligations =
    debts + monthlyEmi;

  const totalDti =
    income > 0
      ? (totalMonthlyObligations /
          income) *
        100
      : 100;

  /*
   * Maximum EMI allowed at 50% DTI.
   */
  const availableForEmi =
    Math.max(
      income * 0.5 - debts,
      0
    );

  const baseMax =
    Math.max(
      Number(
        baseMaxEligibleAmount
      ) || 0,
      0
    );

  let result =
    'eligible';

  if (
    score < 600 ||
    income <= 0 ||
    totalDti > 60
  ) {
    result =
      'not_eligible';
  } else if (
    amount > baseMax ||
    totalDti > 50
  ) {
    result =
      'partially_eligible';
  }

  const roundedDti =
    round2(totalDti);

  const reasons = [];

  if (score < 600) {
    reasons.push(
      'The simulated credit score is below the minimum threshold.'
    );
  }

  if (
    amount > baseMax &&
    baseMax > 0
  ) {
    reasons.push(
      `The selected amount is above the base eligible limit of ₹${Math.round(
        baseMax
      ).toLocaleString('en-IN')}.`
    );
  }

  if (roundedDti > 60) {
    reasons.push(
      `Existing debt plus the proposed EMI would create a DTI of ${roundedDti}%, above the 60% maximum.`
    );
  } else if (
    roundedDti > 50
  ) {
    reasons.push(
      `Existing debt plus the proposed EMI would create a DTI of ${roundedDti}%, above the preferred 50% affordability range.`
    );
  } else {
    reasons.push(
      `Existing debt plus the proposed EMI would create a DTI of ${roundedDti}%, within the preferred affordability range.`
    );
  }

  return {
    result,

    totalDti:
      roundedDti,

    availableForEmi:
      round2(availableForEmi),

    monthlyEmi:
      round2(monthlyEmi),

    maxBaseEligibleAmount:
      round2(baseMax),

    reasons,

    message:
      result === 'eligible'
        ? 'These loan terms pass the simulated affordability check.'
        : result ===
            'partially_eligible'
          ? 'These terms are more aggressive than the preferred affordability range. A lower amount or longer tenure may be safer.'
          : 'These terms fail the simulated affordability check. Choose a lower amount or longer tenure.',
  };
}

module.exports = {
  evaluateEligibility,
  evaluateTermEligibility,
  creditBand,
};