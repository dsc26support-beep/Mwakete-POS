# Capability register (POS-001 to POS-172, plus sections M and N)

Source: "Mwakete POS — Master Capability & Development Reference" (37 pages). The PDF's own statuses are **not evidence**; every row below was checked against this repository's code and tests.

Status key: **Verified** = implemented and covered by a test that was run. **Partial** = some of it exists (the note says what is missing). **Missing** = not implemented. **N/A-ext** = needs an external provider or information that is not available (stated).
This file is updated whenever a capability changes. Last full audit: 2026-11-25 (Phase 0). Test evidence names refer to `tests/` (unit), `tests/e2e/` (browser), `tests/rules/` (Firestore rules, emulator), `tests/a11y/`.

## A. Sales and checkout
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-001 | Create new sales transaction | Verified | e2e tiers, refunds, resilience |
| POS-002 | Add products to cart | Verified | e2e tiers, resilience |
| POS-003 | Remove products from cart | Verified | decrement to zero removes the line (e2e) |
| POS-004 | Modify product quantity | Verified | +/− controls (e2e) |
| POS-005 | Calculate totals automatically | Verified | unit retail/wholesale/invoices |
| POS-006 | Calculate change due | Verified | CheckoutCore.changeDue + live change display (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-007 | Cancel transactions | Partial | clear cart works; cancelling a completed sale = credit note only |
| POS-008 | Hold or suspend a sale | Verified | hold/resume stored on the device, survives reload (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-009 | Resume held sales | Verified | hold/resume stored on the device, survives reload (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-010 | Clear cart | Verified | e2e |
| POS-011 | Prevent invalid quantities | Verified | quantity capped at 9999 per line (e2e catalogue) |
| POS-012 | Handle checkout validation | Partial | invoice/credit-limit/payment-method checks exist |
| POS-013 | Display checkout totals clearly | Verified | e2e |
| POS-014 | Checkout without customer account | Verified | e2e |
| POS-015 | Complete checkout with customer selection | Verified | e2e wholesale/retail |
| POS-016 | Record transaction timestamp | Verified | `createdAt` on every sale |
| POS-017 | Generate unique transaction ID | Verified | UUID per sale |
| POS-018 | Prevent duplicate transactions | Verified | idempotent ID, rules accept identical re-send only (rules tests) |
| POS-019 | Save completed transactions locally | Verified | IndexedDB (resilience e2e) |
| POS-020 | Confirm transaction completion | Verified | toast + receipt |

## B. Barcode and product lookup
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-021 | Camera-based barcode scanning | Missing | |
| POS-022 | Hardware barcode scanner support | Partial | keyboard-wedge scanners work on Retail+ only |
| POS-023 | Search products by name | Verified | e2e resilience |
| POS-024 | Search products by barcode | Verified | SKU/barcode field searched |
| POS-025 | Search by product SKU | Verified | same field |
| POS-026 | Add scanned products to cart | Partial | Retail+ only |
| POS-027 | Handle unknown barcodes | Missing | |
| POS-028 | Register new product from unknown barcode | Missing | |
| POS-029 | Scanner keyboard compatibility | Partial | Enter-terminated scans, Retail+ only |
| POS-030 | Product lookup during offline mode | Verified | local IndexedDB (resilience e2e) |

## C. Product management
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-031 | Create products | Verified | e2e |
| POS-032 | Edit products | Verified | edit dialog (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-033 | Delete or archive products | Verified | archive/restore keeps history; delete still available (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-034 | Product name | Verified | |
| POS-035 | Product description | Verified | description, synced (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-036 | Product SKU | Verified | one field serves SKU and barcode |
| POS-037 | Product barcode | Partial | same field as SKU, no separate barcode |
| POS-038 | Product category | Verified | Retail+ |
| POS-039 | Product image | Verified | small picture, stored on this device only (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-040 | Product cost price | Verified | cost price, stored on this device only so cashiers cannot see margins (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-041 | Product retail price | Verified | |
| POS-042 | Product wholesale price | Partial | via price lists |
| POS-043 | Product quantity | Verified | |
| POS-044 | Unit of measurement | Verified | unit list, synced (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-045 | Availability status | Verified | available / low / out / archived status (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-046 | Product import | Verified | CSV (unit + e2e) |
| POS-047 | Bulk product editing | Verified | bulk price %, category, unit, archive, restore (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-048 | Product export | Verified | CSV (unit + e2e) |

## D. Inventory management
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-049 | View current stock | Verified | |
| POS-050 | Reduce stock after sales | Verified | e2e |
| POS-051 | Increase stock after receiving | Verified | stock + purchasing e2e |
| POS-052 | Manual stock adjustments | Verified | stock e2e |
| POS-053 | Record adjustment reason | Verified | |
| POS-054 | Inventory movement history | Partial | sales and returns write no movement |
| POS-055 | Stock count | Verified | "count" action |
| POS-056 | Stock reconciliation | Partial | single-product count only, no full stock-take or variance report |
| POS-057 | Low-stock alerts | Partial | Retail low-stock list |
| POS-058 | Out-of-stock alerts | Verified | out-of-stock alert line and badges (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-059 | Stock valuation | Verified | valuation at selling price and at cost; products without cost are called out (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-060 | Inventory search | Verified | search by name, barcode, description (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-061 | Inventory category filtering | Verified | category filter (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-062 | Inventory export | Verified | CSV export includes stock |
| POS-063 | Stock receiving | Verified | purchase orders |
| POS-064 | Inventory audit trail | Partial | movements without device/user on local records |
| POS-065 | Inventory transaction integrity | Partial | |
| POS-066 | Stock availability validation | Partial | warns when a sale goes past this device's stock count; never blocks because counts can be stale |

## E. Retail and wholesale pricing
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-067 | Retail price | Verified | |
| POS-068 | Wholesale price | Partial | price lists |
| POS-069 | Customer-specific prices | Partial | per-customer price list, no per-product override |
| POS-070 | Bulk pricing | Partial | pack sizes |
| POS-071 | Quantity-based discounts | Missing | |
| POS-072 | Manual discounts | Verified | |
| POS-073 | Percentage discounts | Verified | |
| POS-074 | Fixed amount discounts | Verified | |
| POS-075 | Discount authorization rules | Missing | |
| POS-076 | Minimum wholesale quantity | Missing | |
| POS-077 | Pricing validation | Partial | |
| POS-078 | Price change history | Verified | last 20 price changes per product, synced (js/catalogue.js; tests/catalogue.test.js; e2e/catalogue) |
| POS-079 | Price rounding rules | Partial | exact cents; no cash rounding option |
| POS-080 | Prevent unauthorized price overrides | Partial | no price editing at the till; rules cannot verify prices |

## F. Payments
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-081 | Cash payments | Verified | |
| POS-082 | Bank EFTPOS/card recording | Verified | EFTPOS/card recorded, never verified (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-083 | Internet Banking recording | Verified | Internet banking recorded, never verified (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-084 | MPaisa recording | Verified | M-PAiSA recorded, never verified (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-085 | Split payments | Verified | up to 4 payment lines that must add up; rules validate (rules test) |
| POS-086 | Partial payment recording | Verified | split payments plus account payments (e2e checkout, invoices) |
| POS-087 | Payment validation | Verified | overpay, duplicates, unknown methods refused (unit) |
| POS-088 | Payment method reporting | Partial | methodTotals + cloud report split by method; no local report screen yet |
| POS-089 | Cash change calculation | Verified | CheckoutCore.changeDue + live change display (js/checkout.js; tests/checkout.test.js; e2e/checkout) |
| POS-090 | Cash reconciliation | Verified | register e2e |
| POS-091 | Cash drawer opening balance | Verified | |
| POS-092 | Cash drawer closing balance | Verified | |
| POS-093 | Cash discrepancy reporting | Verified | shift report |
| POS-094 | Refund payment tracking | Verified | refund method |
| POS-095 | Payment transaction integrity | Partial | |

## G. Receipts and customers
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-096 | Generate receipt | Verified | |
| POS-097 | Receipt number | Verified | R-<device>-<seq> on every new sale, shown on receipts (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-098 | Receipt formatting | Verified | 32-column text |
| POS-099 | Print receipt | Partial | browser print only; no thermal-printer driver |
| POS-100 | Digital receipt | Verified | copy as text, or send from the details dialog (js/delivery.js; tests/delivery.test.js; e2e/delivery) |
| POS-101 | Email receipt | Verified | mailto link opens the user's email app; user confirms (js/delivery.js; tests/delivery.test.js; e2e/delivery). Not automatic: no paid email service |
| POS-102 | SMS receipt | Verified | sms link opens the user's messaging app; user confirms (js/delivery.js; tests/delivery.test.js; e2e/delivery). Not automatic: no paid SMS service |
| POS-103 | WhatsApp receipt | Verified | wa.me link opens WhatsApp; user confirms (js/delivery.js; tests/delivery.test.js; e2e/delivery). Not the WhatsApp Business API |
| POS-104 | Receipt delivery queue | Verified | local queue, up to 200, survives reload (js/delivery.js; tests/delivery.test.js; e2e/delivery) |
| POS-105 | Receipt delivery status | Verified | Queued / Sending / Delivered / Failed / Retry pending / Cancelled; Delivered means the user confirmed it (js/delivery.js; tests/delivery.test.js; e2e/delivery) |
| POS-106 | Retry failed delivery | Verified | Failed -> Retry -> Send again, attempts counted (js/delivery.js; tests/delivery.test.js; e2e/delivery) |
| POS-107 | Customer database | Verified | local customer list with search at checkout |
| POS-108 | Customer contact details | Verified | phone, email, address, customer group, note validated (js/delivery.js; tests/delivery.test.js; e2e/delivery) |
| POS-109 | Customer purchase history | Partial | trade statements only |
| POS-110 | Customer selection at checkout | Verified | |

## H. Transaction management
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-111 | Transaction history | Verified | |
| POS-112 | Transaction search | Verified | search by receipt, product, payment reference (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-113 | Transaction filtering | Verified | filters: dates, payment method, status (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-114 | View transaction details | Verified | details dialog (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-115 | Transaction status | Verified | Completed / Partly or Fully refunded / On account / Not accepted by the cloud (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-116 | Transaction export | Verified | CSV export of the filtered list, formulas neutralised (js/txn.js; tests/txn.test.js; e2e/txn) |
| POS-117 | Transaction audit history | Partial | history is derived from the sale and its credit notes; no separate immutable log yet (batch 6) |
| POS-118 | Transaction cancellation controls | Partial | a sale cannot be edited or deleted; cancel = full refund (credit note) |
| POS-119 | Transaction correction workflow | Partial | correction = refund + new sale; explained in the details dialog; no guided wizard |
| POS-120 | Transaction integrity checks | Verified | TxnCore.checkIntegrity re-adds lines, discount and payments (js/txn.js; tests/txn.test.js; e2e/txn) |

## I. Returns and refunds
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-121 | Return products | Verified | refunds e2e |
| POS-122 | Full transaction return | Verified | |
| POS-123 | Partial transaction return | Verified | |
| POS-124 | Return reason | Verified | |
| POS-125 | Return inventory handling | Verified | restock option |
| POS-126 | Refund recording | Verified | |
| POS-127 | Refund payment method tracking | Verified | |
| POS-128 | Refund authorization | Missing | no approval or limit for cashiers |
| POS-129 | Return history | Verified | |
| POS-130 | Return audit trail | Partial | |

## J. Offline operation and synchronization
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-131 | Offline application access | Verified | service worker (resilience e2e) |
| POS-132 | Offline product access | Verified | |
| POS-133 | Offline checkout | Verified | resilience e2e |
| POS-134 | Offline transaction storage | Verified | |
| POS-135 | Pending synchronization queue | Verified | |
| POS-136 | Automatic synchronization | Verified | |
| POS-137 | Manual synchronization | Verified | |
| POS-138 | Sync status indicator | Verified | |
| POS-139 | Pending sync count | Partial | shown in sync message, no always-visible count |
| POS-140 | Retry failed synchronization | Verified | backoff (unit + e2e) |
| POS-141 | Prevent duplicate synchronization | Verified | |
| POS-142 | Sync conflict handling | Partial | product edits: newest wins, no conflict state |
| POS-143 | Sync recovery | Partial | |
| POS-144 | Sync error reporting | Verified | |
| POS-145 | Protect unsynced transactions | Verified | |
| POS-146 | Offline inventory handling | Partial | per-device stock; no central comparison |

## K. Security and staff management
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-147 | Firebase authentication | Verified | cloud e2e |
| POS-148 | Secure registration | Verified | verified email |
| POS-149 | Secure login | Verified | |
| POS-150 | Logout | Verified | |
| POS-151 | Business data isolation | Verified | rules tests |
| POS-152 | Staff accounts | Verified | |
| POS-153 | Role-based permissions | Partial | owner and cashier only |
| POS-154 | Cashier permissions | Verified | rules tests |
| POS-155 | Manager permissions | Missing | |
| POS-156 | Administrator permissions | Missing | |
| POS-157 | Authorization validation | Verified | rules |
| POS-158 | Security audit log | Missing | |
| POS-159 | Secure offline data handling | Partial | not encrypted at rest |
| POS-160 | Session management | Partial | Firebase sessions; no idle lock |
| POS-161 | Data backup | Verified | backup e2e |
| POS-162 | Recovery procedures | Partial | restore from file; no restore from cloud |

## L. Reports and analytics
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-163 | Daily sales report | Partial | |
| POS-164 | Weekly sales report | Missing | |
| POS-165 | Monthly sales report | Missing | |
| POS-166 | Custom date reports | Missing | |
| POS-167 | Sales by product | Verified | |
| POS-168 | Sales by category | Verified | |
| POS-169 | Sales by cashier | Verified | cloud report |
| POS-170 | Sales by payment method | Verified | cloud report |
| POS-171 | Inventory report | Partial | |
| POS-172 | Profit reporting | Missing | needs cost price |

## M. Device, installability and interface
| Capability | Status | Evidence / gap |
|---|---|---|
| Responsive mobile / tablet / desktop | Partial | one layout; no desktop sidebar |
| Installable PWA, icon, manifest | Partial | SVG icon only: Android install needs PNG icons |
| Offline shell, service worker lifecycle | Verified | resilience e2e; update prompt missing |
| Local storage persistence | Partial | no storage-persist request |
| Device registration / identification / management / removal | Missing | only an invoice device code |
| Multiple devices per business, cross-device sync | Partial | cashiers yes; no device list |
| Network status monitoring | Verified | |
| Application update handling | Partial | silent update |
| Data migration | Verified | IndexedDB upgrade tests |
| Device recovery | Partial | |
| Accessibility, keyboard support | Verified | tests/a11y |
| Touch-friendly controls, adaptive navigation | Partial | |

## N. Optional Mwakete integration
| Capability | Status | Evidence / gap |
|---|---|---|
| Independent POS operation without Mwakete | Verified | |
| Connection, linking, store linking, sync of products/inventory/transactions, authorization, status, disconnect, error reporting, API contract verification, audit logging | N/A-ext | the Mwakete API contract is not available; the PDF forbids inventing APIs. A clearly "not configured" status screen and a documented contract template are planned |

## Cross-cutting requirements (PDF sections 7–21)
Tracked in `docs/CAPABILITY_REGISTER.md` updates below as they are verified: transaction and movement record fields (section 8), delivery states (10), customer privacy (11), report permission controls (13), security audit trail (14), onboarding (16), production acceptance criteria (20), documentation set (22).
