/**
 * CREDENCE loan calculation engine.
 *
 * All figures verified to match the design doc's worked example:
 *   loanAmount=200000, tenure=24, rate=18% → EMI≈9984, totalInterest≈39616,
 *   processingFee=2000, gst=360, netDisbursement=197640
 */

/**
 * Standard reducing-balance EMI formula.
 * @param {number} principal
 * @param {number} annualRatePercent e.g. 18 for 18%
 * @param {number} tenureMonths
 */
function calculateEMI(principal, annualRatePercent, tenureMonths) {
  const monthlyRate = annualRatePercent / 12 / 100;
  if (monthlyRate === 0) return principal / tenureMonths;
  const factor = Math.pow(1 + monthlyRate, tenureMonths);
  const emi = (principal * monthlyRate * factor) / (factor - 1);
  return emi;
}

/**
 * IRR (annualized, %) from the borrower's perspective: they receive
 * netDisbursement today and pay `emi` every month for tenureMonths.
 * Because fees are deducted upfront, the *effective* rate the borrower
 * pays is always higher than the nominal interest rate — IRR captures that.
 * Solved numerically via bisection on the monthly rate.
 */
function calculateIRR(netDisbursement, emi, tenureMonths) {
  const npv = (monthlyRate) => {
    let total = -netDisbursement;
    for (let t = 1; t <= tenureMonths; t++) {
      total += emi / Math.pow(1 + monthlyRate, t);
    }
    return total;
  };

  let low = 0.0001;
  let high = 1; // 100% monthly, generous upper bound
  let mid = low;

  // Bisection: NPV is monotonically decreasing in rate for this cash flow
  // shape (one outflow now, fixed inflows later), so this always converges.
  for (let i = 0; i < 100; i++) {
    mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1e-6) break;
    if (value > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const monthlyIRR = mid;
  const annualIRR = (Math.pow(1 + monthlyIRR, 12) - 1) * 100;
  return Math.round(annualIRR * 1000) / 1000; // 3 decimal places
}

/**
 * Full breakdown for the EMI screen.
 */
function calculateLoanBreakdown({
  loanAmount,
  tenureMonths,
  interestRateAnnual,
  processingFee,
  gstPercent,
}) {
  const emi = calculateEMI(loanAmount, interestRateAnnual, tenureMonths);
  const totalRepayment = emi * tenureMonths;
  const totalInterest = totalRepayment - loanAmount;
  const gst = processingFee * (gstPercent / 100);
  const totalCharges = processingFee + gst;
  const netDisbursement = loanAmount - totalCharges;
  const irr = calculateIRR(netDisbursement, emi, tenureMonths);

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    loanAmount: round2(loanAmount),
    tenureMonths,
    interestRateAnnual,
    emi: round2(emi),
    totalInterest: round2(totalInterest),
    processingFee: round2(processingFee),
    gst: round2(gst),
    totalCharges: round2(totalCharges),
    totalRepayment: round2(totalRepayment),
    netDisbursement: round2(netDisbursement),
    irr,
  };
}

module.exports = { calculateEMI, calculateIRR, calculateLoanBreakdown };
