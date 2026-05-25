Fahampesa Core Modules Overview
Core Structure
• Branch, Inventory, and Supplier modules must connect cleanly using branch_id.
• All data must remain isolated per branch.
1. Branch Module (Up to 6 Branches)
• Each branch represents one physical store.
• System must support adding up to 6 branches.
• Branch selector dropdown at top of dashboard.
• Changing branch reloads inventory, sales, and reports.
• No data mixing between branches.
• Every sale must include branch_id.
• Every inventory record must include branch_id.
• Every expense must include branch_id.
• Independent stock per branch.
• Stock transfer between branches.
• Central dashboard view for owner.
• Per branch sales report.
• Per branch stock valuation.
• Per branch low stock alert.
• Cashier sees only assigned branch.
• Manager sees assigned branch.
• Owner sees all branches.
• Branch creation fields remain as currently structured.
2. Inventory Module
• Track products per branch accurately.
• Top section must include branch selector, search product, add product, bulk upload, export
report.
• Table columns: Product name, Barcode with label print, Category, Quantity, Reorder level, Cost
price, Selling price, Stock value, Status.
• Stock value equals Quantity multiplied by Cost price.
• Product detail page shows product info, image, supplier, cost price, selling price, profit margin,
stock per branch, stock movement history.
• Stock increases by purchase, manual adjustment, transfer in.
• Stock decreases by sale, transfer out, adjustment.
• Every adjustment must save quantity, reason, user, timestamp.
3. Supplier Module
• Manage suppliers and purchase tracking.
• Supplier list must show supplier name, contact, total purchases, outstanding balance, status.
• Add supplier fields: Name, Contact person, Phone, Email, Address, Opening balance, Payment
terms.
• Supplier detail page shows total purchases, total paid, outstanding balance.
• Tabs: Purchases, Payments, Ledger.
• When purchase is created, inventory increases in selected branch.
• Supplier balance updates automatically.
• If unpaid, create payable.
4. Integration Rules
• All purchases must select a branch.
• Inventory must always be branch specific.
• Transfers must deduct from one branch and add to another.
• Reports must support per branch and all branches.
5. Clean System Rules
• Every number must update live.
• Hide cost price from cashier.
• Owner sees centralized analytics.
• Settings remain as currently structured but must be fully functional.