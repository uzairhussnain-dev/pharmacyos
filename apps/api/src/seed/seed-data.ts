/**
 * Fictional but realistic catalogue for a Pakistani community pharmacy.
 * Prices are per BASE UNIT in paisa (PKR × 100). Brand names are common PK market brands used for
 * demo realism only; prices are illustrative. Most medicines are sales-tax exempt in Pakistan, so
 * taxRateBps is 0 except for a few general-store items.
 */
const p = (
  sku: string,
  brandName: string,
  genericName: string,
  strength: string,
  dosageForm: string,
  category: string,
  baseUnit: string,
  priceMajor: number,
  opts: Partial<{ packName: string; packMultiplier: number; barcode: string; requiresPrescription: boolean; saleRestriction: 'OTC' | 'PRESCRIPTION' | 'CONTROLLED'; manufacturer: string; reorderLevel: number; reorderQuantity: number; taxRateBps: number; leadTimeDays: number }> = {},
) => ({
  sku,
  barcode: opts.barcode,
  brandName,
  genericName,
  strength,
  dosageForm,
  route: dosageForm === 'Tablet' || dosageForm === 'Capsule' || dosageForm === 'Syrup' ? 'Oral' : dosageForm === 'Injection' ? 'Parenteral' : 'Topical',
  manufacturer: opts.manufacturer,
  category,
  baseUnit,
  packUnits: opts.packName ? [{ name: opts.packName, multiplier: opts.packMultiplier ?? 10 }] : [],
  sellingPriceMinor: Math.round(priceMajor * 100),
  taxClass: opts.taxRateBps ? 'STANDARD' : 'EXEMPT',
  taxRateBps: opts.taxRateBps ?? 0,
  saleRestriction: opts.saleRestriction ?? (opts.requiresPrescription ? 'PRESCRIPTION' : 'OTC'),
  requiresPrescription: opts.requiresPrescription ?? false,
  isActive: true,
  tracksExpiry: true,
  reorderLevel: opts.reorderLevel ?? 100,
  reorderQuantity: opts.reorderQuantity ?? 200,
  leadTimeDays: opts.leadTimeDays ?? 3,
});

let bc = 8964000100000;
const code = () => String(++bc);

export const PRODUCTS = [
  // Analgesics
  p('PAN-500', 'Panadol', 'Paracetamol', '500mg', 'Tablet', 'Analgesic', 'Tablet', 2.5, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 300, reorderQuantity: 1000 }),
  p('PAN-EX', 'Panadol Extra', 'Paracetamol + Caffeine', '500mg/65mg', 'Tablet', 'Analgesic', 'Tablet', 3.5, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 200 }),
  p('BRU-400', 'Brufen', 'Ibuprofen', '400mg', 'Tablet', 'Analgesic', 'Tablet', 4, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Abbott', reorderLevel: 200 }),
  p('BRU-SYP', 'Brufen Syrup', 'Ibuprofen', '100mg/5ml', 'Syrup', 'Analgesic', 'Bottle', 95, { barcode: code(), manufacturer: 'Abbott', reorderLevel: 20, reorderQuantity: 48 }),
  p('DIS-50', 'Disprin', 'Aspirin', '300mg', 'Tablet', 'Analgesic', 'Tablet', 1.8, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Reckitt', reorderLevel: 150 }),
  p('CAL-SYP', 'Calpol', 'Paracetamol', '120mg/5ml', 'Syrup', 'Analgesic', 'Bottle', 85, { barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 20, reorderQuantity: 48 }),
  p('VOL-50', 'Voltral', 'Diclofenac Sodium', '50mg', 'Tablet', 'Analgesic', 'Tablet', 6, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Novartis', reorderLevel: 100 }),
  // Antibiotics (Rx)
  p('AUG-625', 'Augmentin', 'Amoxicillin + Clavulanic Acid', '625mg', 'Tablet', 'Antibiotic', 'Tablet', 48, { packName: 'Strip', packMultiplier: 6, barcode: code(), manufacturer: 'GSK Pakistan', requiresPrescription: true, reorderLevel: 60, reorderQuantity: 120 }),
  p('AMX-500', 'Amoxil', 'Amoxicillin', '500mg', 'Capsule', 'Antibiotic', 'Capsule', 12, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'GSK Pakistan', requiresPrescription: true, reorderLevel: 100 }),
  p('AZT-250', 'Zithromax', 'Azithromycin', '250mg', 'Capsule', 'Antibiotic', 'Capsule', 65, { packName: 'Strip', packMultiplier: 6, barcode: code(), manufacturer: 'Pfizer', requiresPrescription: true, reorderLevel: 36 }),
  p('CIP-500', 'Novidat', 'Ciprofloxacin', '500mg', 'Tablet', 'Antibiotic', 'Tablet', 22, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Sami', requiresPrescription: true, reorderLevel: 60 }),
  p('FLG-400', 'Flagyl', 'Metronidazole', '400mg', 'Tablet', 'Antibiotic', 'Tablet', 5, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Sanofi', requiresPrescription: true, reorderLevel: 100 }),
  p('CEF-SYP', 'Cefspan Syrup', 'Cefixime', '100mg/5ml', 'Syrup', 'Antibiotic', 'Bottle', 420, { barcode: code(), manufacturer: 'Barrett Hodgson', requiresPrescription: true, reorderLevel: 10, reorderQuantity: 24 }),
  // Antihistamine / Cold
  p('AVL-10', 'Avil', 'Pheniramine Maleate', '25mg', 'Tablet', 'Antihistamine', 'Tablet', 2.2, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Sanofi', reorderLevel: 100 }),
  p('ZYR-10', 'Zyrtec', 'Cetirizine', '10mg', 'Tablet', 'Antihistamine', 'Tablet', 9, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 100 }),
  p('RIG-10', 'Rigix', 'Cetirizine', '10mg', 'Tablet', 'Antihistamine', 'Tablet', 6, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Hilton', reorderLevel: 100 }),
  p('ACT-SYP', 'Actifed DM', 'Dextromethorphan + Triprolidine + Pseudoephedrine', '-', 'Syrup', 'Antihistamine', 'Bottle', 160, { barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 12 }),
  p('HYD-SYP', 'Hydryllin', 'Aminophylline + Diphenhydramine', '-', 'Syrup', 'Antihistamine', 'Bottle', 110, { barcode: code(), manufacturer: 'Searle', reorderLevel: 12 }),
  // Gastro
  p('RIS-20', 'Risek', 'Omeprazole', '20mg', 'Capsule', 'Gastro', 'Capsule', 14, { packName: 'Strip', packMultiplier: 14, barcode: code(), manufacturer: 'Getz', reorderLevel: 140 }),
  p('NEX-40', 'Nexum', 'Esomeprazole', '40mg', 'Capsule', 'Gastro', 'Capsule', 24, { packName: 'Strip', packMultiplier: 14, barcode: code(), manufacturer: 'Getz', reorderLevel: 70 }),
  p('MOT-10', 'Motilium', 'Domperidone', '10mg', 'Tablet', 'Gastro', 'Tablet', 7, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Janssen', reorderLevel: 100 }),
  p('GRA-SYP', 'Gaviscon', 'Sodium Alginate + Sodium Bicarbonate', '-', 'Syrup', 'Gastro', 'Bottle', 310, { barcode: code(), manufacturer: 'Reckitt', reorderLevel: 10 }),
  p('ORS-1', 'ORS Sachet', 'Oral Rehydration Salts', '20.5g', 'Sachet', 'Gastro', 'Sachet', 30, { packName: 'Box', packMultiplier: 20, barcode: code(), manufacturer: 'Searle', reorderLevel: 100, reorderQuantity: 400 }),
  p('IMO-2', 'Imodium', 'Loperamide', '2mg', 'Capsule', 'Gastro', 'Capsule', 12, { packName: 'Strip', packMultiplier: 6, barcode: code(), manufacturer: 'Janssen', reorderLevel: 60 }),
  // Cardio / Diabetes (chronic, Rx)
  p('CON-5', 'Concor', 'Bisoprolol', '5mg', 'Tablet', 'Cardiovascular', 'Tablet', 18, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Merck', requiresPrescription: true, reorderLevel: 100 }),
  p('NOR-5', 'Norvasc', 'Amlodipine', '5mg', 'Tablet', 'Cardiovascular', 'Tablet', 16, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Pfizer', requiresPrescription: true, reorderLevel: 100 }),
  p('LIP-20', 'Lipiget', 'Atorvastatin', '20mg', 'Tablet', 'Cardiovascular', 'Tablet', 22, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Getz', requiresPrescription: true, reorderLevel: 100 }),
  p('GLU-500', 'Glucophage', 'Metformin', '500mg', 'Tablet', 'Diabetes', 'Tablet', 4.5, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Merck', requiresPrescription: true, reorderLevel: 200, reorderQuantity: 500 }),
  p('GET-2', 'Getryl', 'Glimepiride', '2mg', 'Tablet', 'Diabetes', 'Tablet', 15, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Getz', requiresPrescription: true, reorderLevel: 100 }),
  p('INS-MIX', 'Humulin 70/30', 'Insulin Human', '100IU/ml 10ml', 'Injection', 'Diabetes', 'Vial', 1650, { barcode: code(), manufacturer: 'Eli Lilly', requiresPrescription: true, reorderLevel: 6, reorderQuantity: 12, leadTimeDays: 5 }),
  // Vitamins / Supplements
  p('SUR-TAB', 'Surbex-Z', 'Multivitamin + Zinc', '-', 'Tablet', 'Vitamins', 'Tablet', 14, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Abbott', reorderLevel: 100 }),
  p('CAC-500', 'CaC-1000 Plus', 'Calcium + Vitamin C', '-', 'Tablet', 'Vitamins', 'Tablet', 22, { packName: 'Tube', packMultiplier: 10, barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 100 }),
  p('FOL-5', 'Folic Acid', 'Folic Acid', '5mg', 'Tablet', 'Vitamins', 'Tablet', 1.5, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Various', reorderLevel: 100 }),
  p('D3-200K', 'Indrop-D', 'Cholecalciferol', '200,000 IU', 'Injection', 'Vitamins', 'Ampoule', 240, { barcode: code(), manufacturer: 'Hilton', reorderLevel: 10 }),
  // Topicals / Others
  p('POL-OIN', 'Polyfax', 'Polymyxin B + Bacitracin', '20g', 'Ointment', 'Topical', 'Tube', 185, { barcode: code(), manufacturer: 'GSK Pakistan', reorderLevel: 12 }),
  p('BET-CRM', 'Betnovate', 'Betamethasone', '0.1% 15g', 'Cream', 'Topical', 'Tube', 130, { barcode: code(), manufacturer: 'GSK Pakistan', requiresPrescription: true, reorderLevel: 12 }),
  p('DET-250', 'Dettol Liquid', 'Chloroxylenol', '250ml', 'Antiseptic', 'Hygiene', 'Bottle', 350, { barcode: code(), manufacturer: 'Reckitt', reorderLevel: 10, taxRateBps: 1800 }),
  p('BAND-10', 'Band-Aid', 'Adhesive Bandage', 'Assorted', 'Dressing', 'Hygiene', 'Strip', 15, { packName: 'Box', packMultiplier: 20, barcode: code(), manufacturer: 'J&J', reorderLevel: 50, taxRateBps: 1800 }),
  p('MASK-50', 'Surgical Mask', '3-ply mask', '-', 'Consumable', 'Hygiene', 'Piece', 8, { packName: 'Box', packMultiplier: 50, barcode: code(), reorderLevel: 100, reorderQuantity: 500, taxRateBps: 1800 }),
  p('SYR-5', 'Disposable Syringe', 'Syringe', '5ml', 'Consumable', 'Hygiene', 'Piece', 18, { packName: 'Box', packMultiplier: 100, barcode: code(), reorderLevel: 100, reorderQuantity: 300 }),
  // Controlled (demonstrates restriction handling; flag only — regulatory specifics must be configured by the pharmacy)
  p('LEX-1', 'Lexotanil', 'Bromazepam', '1.5mg', 'Tablet', 'CNS', 'Tablet', 9, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Roche', requiresPrescription: true, saleRestriction: 'CONTROLLED', reorderLevel: 30 }),
  p('XAN-05', 'Xanax', 'Alprazolam', '0.5mg', 'Tablet', 'CNS', 'Tablet', 11, { packName: 'Strip', packMultiplier: 10, barcode: code(), manufacturer: 'Pfizer', requiresPrescription: true, saleRestriction: 'CONTROLLED', reorderLevel: 30 }),
  // Slow mover (so slow-moving analytics have something)
  p('NEB-SOL', 'Nebuliser Solution', 'Sodium Chloride', '0.9% 5ml', 'Solution', 'Respiratory', 'Nebule', 25, { packName: 'Box', packMultiplier: 20, barcode: code(), reorderLevel: 0, reorderQuantity: 40 }),
  p('GLUCO-M', 'Glucometer Strips', 'Test Strips', '50s', 'Consumable', 'Diabetes', 'Box', 1850, { barcode: code(), manufacturer: 'Accu-Chek', reorderLevel: 3, reorderQuantity: 10, leadTimeDays: 7 }),
];

export const SUPPLIERS = [
  { name: 'Getz Pharma Distribution', contactName: 'Imran Bhatti', phone: '042-35761000', email: 'orders@getz-dist.example', address: 'Ferozepur Road, Lahore', paymentTermsDays: 30, leadTimeDays: 3, acceptsExpiryReturns: true, isActive: true },
  { name: 'Muller & Phipps Pakistan', contactName: 'Saira Khan', phone: '021-34549000', email: 'lhr@mp.example', address: 'Industrial Estate, Kot Lakhpat, Lahore', paymentTermsDays: 45, leadTimeDays: 4, acceptsExpiryReturns: true, isActive: true },
  { name: 'Premier Agencies', contactName: 'Tariq Mehmood', phone: '042-37230000', email: 'sales@premier.example', address: 'Shahrah-e-Quaid-e-Azam, Lahore', paymentTermsDays: 15, leadTimeDays: 2, acceptsExpiryReturns: false, isActive: true },
  { name: 'Al-Noor Medical Store (Wholesale)', contactName: 'Noor Muhammad', phone: '0300-4000000', paymentTermsDays: 0, leadTimeDays: 1, acceptsExpiryReturns: false, isActive: true },
];
