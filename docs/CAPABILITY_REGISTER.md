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
| POS-006 | Calculate change due | Missing | no cash-tendered input yet |
| POS-007 | Cancel transactions | Partial | clear cart works; cancelling a completed sale = credit note only |
| POS-008 | Hold or suspend a sale | Missing | |
| POS-009 | Resume held sales | Missing | |
| POS-010 | Clear cart | Verified | e2e |
| POS-011 | Prevent invalid quantities | Partial | +/− only; no upper bound or stock check |
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
| POS-032 | Edit products | Missing | list has Remove only |
| POS-033 | Delete or archive products | Partial | delete only, no archive |
| POS-034 | Product name | Verified | |
| POS-035 | Product description | Missing | |
| POS-036 | Product SKU | Verified | one field serves SKU and barcode |
| POS-037 | Product barcode | Partial | same field as SKU, no separate barcode |
| POS-038 | Product category | Verified | Retail+ |
| POS-039 | Product image | Missing | |
| POS-040 | Product cost price | Missing | |
| POS-041 | Product retail price | Verified | |
| POS-042 | Product wholesale price | Partial | via price lists |
| POS-043 | Product quantity | Verified | |
| POS-044 | Unit of measurement | Missing | |
| POS-045 | Availability status | Missing | |
| POS-046 | Product import | Verified | CSV (unit + e2e) |
| POS-047 | Bulk product editing | Missing | |
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
| POS-058 | Out-of-stock alerts | Missing | |
| POS-059 | Stock valuation | Missing | needs cost price |
| POS-060 | Inventory search | Partial | product search only |
| POS-061 | Inventory category filtering | Missing | |
| POS-062 | Inventory export | Verified | CSV export includes stock |
| POS-063 | Stock receiving | Verified | purchase orders |
| POS-064 | Inventory audit trail | Partial | movements without device/user on local records |
| POS-065 | Inventory transaction integrity | Partial | |
| POS-066 | Stock availability validation | Missing | |

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
| POS-078 | Price change history | Missing | |
| POS-079 | Price rounding rules | Partial | exact cents; no cash rounding option |
| POS-080 | Prevent unauthorized price overrides | Partial | no price editing at the till; rules cannot verify prices |

## F. Payments
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-081 | Cash payments | Verified | |
| POS-082 | Bank EFTPOS/card recording | Missing | only "Other" |
| POS-083 | Internet Banking recording | Missing | |
| POS-084 | MPaisa recording | Missing | |
| POS-085 | Split payments | Missing | |
| POS-086 | Partial payment recording | Partial | payments against a credit account |
| POS-087 | Payment validation | Partial | |
| POS-088 | Payment method reporting | Partial | cloud report only |
| POS-089 | Cash change calculation | Missing | |
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
| POS-097 | Receipt number | Missing | sales show an ID prefix; invoices have INV numbers |
| POS-098 | Receipt formatting | Verified | 32-column text |
| POS-099 | Print receipt | Partial | browser print only; no thermal-printer driver |
| POS-100 | Digital receipt | Partial | copy as text |
| POS-101 | Email receipt | Missing | |
| POS-102 | SMS receipt | Missing | |
| POS-103 | WhatsApp receipt | Missing | |
| POS-104 | Receipt delivery queue | Missing | |
| POS-105 | Receipt delivery status | Missing | |
| POS-106 | Retry failed delivery | Missing | |
| POS-107 | Customer database | Verified | local |
| POS-108 | Customer contact details | Partial | |
| POS-109 | Customer purchase history | Partial | trade statements only |
| POS-110 | Customer selection at checkout | Verified | |

## H. Transaction management
| ID | Capability | Status | Evidence / gap |
|---|---|---|---|
| POS-111 | Transaction history | Verified | |
| POS-112 | Transaction search | Missing | |
| POS-113 | Transaction filtering | Missing | |
| POS-114 | View transaction details | Partial | receipt view |
| POS-115 | Transaction status | Partial | sync status and refunded note |
| POS-116 | Transaction export | Missing | |
| POS-117 | Transaction audit history | Missing | |
| POS-118 | Transaction cancellation controls | Partial | |
| POS-119 | Transaction correction workflow | Partial | credit notes |
| POS-120 | Transaction integrity checks | Partial | |

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
