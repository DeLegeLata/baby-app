import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  ageTicks,
  chartWindow,
  curve,
  imperial,
  lmsAt,
  percentileLabel,
  percentileOf,
  readings,
  show,
  ticks,
  valueAtZ,
  zScore,
  type Reading
} from './growth';

// Reference values from WHO's daily tables for boys (SD columns), checked against
// the kept rows and the straight-line reading between them.
describe('the WHO tables', () => {
  it('match WHO on kept days', () => {
    expect(lmsAt('weight', 0)).toEqual([0, 0.3487, 3.3464, 0.14602]);
    const w365 = lmsAt('weight', 365)!;
    expect(valueAtZ(w365, 0)).toBeCloseTo(9.646, 3);
    expect(valueAtZ(w365, -2)).toBeCloseTo(7.741, 2);
    expect(valueAtZ(w365, 2)).toBeCloseTo(11.983, 2);
    const h365 = lmsAt('height', 365)!;
    expect(valueAtZ(h365, -2)).toBeCloseTo(70.987, 2);
    expect(valueAtZ(h365, 3)).toBeCloseTo(82.867, 2);
  });

  it('match WHO between kept days', () => {
    // day 1000 is not a kept day (every 7th day after the first four weeks)
    const w = lmsAt('weight', 1000)!;
    expect(valueAtZ(w, 0)).toBeCloseTo(13.806, 2);
    expect(valueAtZ(w, 2)).toBeCloseTo(17.559, 1);
    expect(valueAtZ(w, -3)).toBeCloseTo(9.682, 1);
    const h = lmsAt('height', 1000)!;
    expect(valueAtZ(h, 0)).toBeCloseTo(93.971, 1);
    expect(valueAtZ(h, 1)).toBeCloseTo(97.526, 1);
  });

  it('switch from lying length to standing height at the second birthday', () => {
    expect(valueAtZ(lmsAt('height', 730)!, 0)).toBeCloseTo(87.802, 2);
    expect(valueAtZ(lmsAt('height', 731)!, 0)).toBeCloseTo(87.13, 2);
  });

  it('end at 5 years', () => {
    expect(lmsAt('weight', 1856)).not.toBeNull();
    expect(lmsAt('weight', 1857)).toBeNull();
    expect(lmsAt('weight', -1)).toBeNull();
  });
});

describe('z-scores and percentiles', () => {
  it('put the median at the 50th', () => {
    const lms = lmsAt('weight', 500)!;
    expect(zScore(lms[2], lms)).toBeCloseTo(0, 6);
    expect(percentileOf(0)).toBeCloseTo(50, 6);
  });

  it('read a WHO SD line back as its z', () => {
    const lms = lmsAt('weight', 731)!;
    expect(zScore(15.281, lms)).toBeCloseTo(2, 2);
    expect(zScore(9.675, lms)).toBeCloseTo(-2, 2);
  });

  it("use WHO's fixed steps beyond 3 SD", () => {
    const lms = lmsAt('weight', 731)!;
    const sd3 = valueAtZ(lms, 3);
    const step = sd3 - valueAtZ(lms, 2);
    expect(zScore(sd3 + step, lms)).toBeCloseTo(4, 6);
    const low3 = valueAtZ(lms, -3);
    const lowStep = valueAtZ(lms, -2) - low3;
    expect(zScore(low3 - lowStep / 2, lms)).toBeCloseTo(-3.5, 6);
  });

  it('turn z into percentiles', () => {
    expect(percentileOf(1.036433)).toBeCloseTo(85, 2);
    expect(percentileOf(-1.880794)).toBeCloseTo(3, 2);
    expect(percentileOf(1.880794)).toBeCloseTo(97, 2);
  });

  it('say percentiles in words', () => {
    expect(percentileLabel(0.4)).toBe('below the 1st');
    expect(percentileLabel(99.6)).toBe('above the 99th');
    expect(percentileLabel(3.2)).toBe('3rd');
    expect(percentileLabel(61.6)).toBe('62nd');
    expect(percentileLabel(11)).toBe('11th');
    expect(percentileLabel(12.4)).toBe('12th');
    expect(percentileLabel(13)).toBe('13th');
    expect(percentileLabel(21)).toBe('21st');
    expect(percentileLabel(50)).toBe('50th');
  });
});

describe('readings', () => {
  const rows = [
    { id: 'b', measured_on: '2025-11-03', weight_g: 11200, height_mm: null },
    { id: 'a', measured_on: '2025-05-01', weight_g: 9646, height_mm: 757 },
    { id: 'c', measured_on: '2026-11-03', weight_g: null, height_mm: 900 }
  ];

  it('place each against his age that day, oldest first', () => {
    const weight = readings(rows, '2024-05-01', 'weight');
    expect(weight.map((r) => r.id)).toEqual(['a', 'b']);
    expect(weight[0].day).toBe(365);
    expect(weight[0].p).toBeCloseTo(50, 0);
    expect(readings(rows, '2024-05-01', 'height').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('leave the percentile out without a birth date', () => {
    const weight = readings(rows, null, 'weight');
    expect(weight).toHaveLength(2);
    expect(weight.every((r) => r.p === null)).toBe(true);
  });
});

describe('words and numbers', () => {
  it('say his age', () => {
    expect(ageLabel('2024-05-01', '2024-05-06')).toBe('5 days');
    expect(ageLabel('2024-05-01', '2024-06-12')).toBe('6 weeks');
    expect(ageLabel('2024-05-01', '2025-11-03')).toBe('18 months');
    expect(ageLabel('2024-05-01', '2026-05-01')).toBe('2 years');
    expect(ageLabel('2024-05-01', '2026-06-15')).toBe('2 years 1 month');
    expect(ageLabel('2024-05-01', '2026-11-10')).toBe('2 years 6 months');
  });

  it('show weights and heights', () => {
    expect(show(12.4, 'weight')).toBe('12.4 kg');
    expect(show(12.35, 'weight')).toBe('12.35 kg');
    expect(show(87.5, 'height')).toBe('87.5 cm');
    expect(show(90, 'height')).toBe('90 cm');
    expect(imperial(12.4, 'weight')).toBe('27 lb 5 oz');
    expect(imperial(87.5, 'height')).toBe('2 ft 10½ in');
    expect(imperial(91.44, 'height')).toBe('3 ft 0 in');
  });
});

describe('the chart', () => {
  const at = (day: number): Reading => ({ id: String(day), date: '', day, value: 12, z: 0, p: 50 });

  it('spans the last year to three months ahead', () => {
    const win = chartWindow(900, [at(880)]);
    expect(win.from).toBeLessThanOrEqual(535);
    expect(win.to).toBeGreaterThanOrEqual(991);
    expect(win.to - win.from).toBeLessThan(500);
  });

  it('reaches back to his oldest measurement and stops at birth', () => {
    expect(chartWindow(900, [at(60), at(880)]).from).toBe(30);
    expect(chartWindow(100, []).from).toBe(0);
  });

  it('breaks the height curves at the second birthday', () => {
    const win = { from: 500, to: 900 };
    const pieces = curve('height', 0, win);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].at(-1)!.day).toBe(730);
    expect(pieces[1][0].day).toBe(731);
    expect(curve('weight', 0, win)).toHaveLength(1);
  });

  it('picks round ticks', () => {
    expect(ticks(7.6, 16.3, 6)).toEqual([8, 10, 12, 14, 16]);
    expect(ticks(70.2, 101, 7)).toEqual([75, 80, 85, 90, 95, 100]);
    expect(ticks(70.2, 101, 5)).toEqual([80, 90, 100]);
    expect(ageTicks({ from: 548, to: 943 })).toEqual([18, 21, 24, 27, 30]);
  });
});
