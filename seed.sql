-- Demo data: reproduces the budget-vs-actual mockup (Cordova Exchange, Q2 2026).
-- Money in integer cents. Period 6 carries the quarter figures for a simple but
-- end-to-end-correct demo. Run with `npm run seed`.
INSERT INTO entities (id,name,legal_form) VALUES (1,'Hastings Holdings LP','LP');
INSERT INTO buildings (id,entity_id,name,address,city,rentable_area_sqft)
  VALUES (1,1,'Cordova Exchange','525 W Cordova St','Vancouver',100000);
INSERT INTO suites (building_id,suite_number,floor,rentable_area_sqft,status) VALUES
  (1,'200',2,12000,'occupied'),(1,'300',3,18000,'occupied'),(1,'400',4,9000,'vacant');

INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,sort_order) VALUES
  (10,'5000','Repairs & operations','operating_expense',1,0,10),
  (20,'6000','Fixed & administrative','operating_expense',0,0,20);
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (11,'5100','Repairs & maintenance','operating_expense',1,1,10,11),
  (12,'5200','Utilities','operating_expense',1,1,10,12),
  (13,'5300','Janitorial','operating_expense',1,1,10,13),
  (14,'5400','Landscaping & snow removal','operating_expense',1,1,10,14),
  (21,'6100','Property taxes','tax',0,1,20,21),
  (22,'6200','Insurance','operating_expense',0,1,20,22),
  (23,'6300','Property management fee','operating_expense',0,1,20,23),
  (24,'6400','Security','operating_expense',1,1,20,24);

INSERT INTO vendors (id,name,default_gl_account_id,match_aliases) VALUES
  (1,'Pinnacle Roofing Ltd',11,'["Pinnacle Roofing","Pinnacle Roofing Ltd."]'),
  (2,'BC Hydro',12,'["BC Hydro","British Columbia Hydro & Power Authority"]'),
  (3,'Westcoast Janitorial',13,'["Westcoast Janitorial","West Coast Janitorial Inc"]'),
  (4,'GreenBlade Landscaping',14,'["GreenBlade","GreenBlade Landscaping"]');

INSERT INTO budgets (building_id,gl_account_id,fiscal_year,period,amount_cents) VALUES
  (1,11,2026,6,1800000),(1,12,2026,6,2700000),(1,13,2026,6,1500000),(1,14,2026,6,900000),
  (1,21,2026,6,8400000),(1,22,2026,6,1200000),(1,23,2026,6,2100000),(1,24,2026,6,1350000);

INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status,source) VALUES
  (1,1,1,'PR-4471','2026-06-15',2280000,'paid','upload'),
  (2,2,1,'HY-0091','2026-06-10',2110000,'paid','email'),
  (3,3,1,'WJ-220','2026-06-12',1425000,'paid','email'),
  (4,4,1,'GB-77','2026-06-08',1160000,'paid','email');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents,coding_source) VALUES
  (1,11,'Roof membrane replacement',2280000,'vendor_default'),
  (2,12,'Electricity — June',2110000,'vendor_default'),
  (3,13,'Monthly janitorial contract',1425000,'vendor_default'),
  (4,14,'Snow removal + grounds',1160000,'vendor_default');
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status) VALUES
  (5,1,1,'TAX-Q2','2026-06-01',8400000,'paid'),(6,1,1,'INS-26','2026-06-01',1245000,'paid'),
  (7,1,1,'MGMT-06','2026-06-01',2100000,'paid'),(8,1,1,'SEC-06','2026-06-01',1290000,'paid');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents) VALUES
  (5,21,'Property taxes Q2',8400000),(6,22,'Insurance premium',1245000),
  (7,23,'Management fee June',2100000),(8,24,'Security June',1290000);
INSERT INTO accruals (building_id,gl_account_id,fiscal_year,accrual_period,reverse_period,amount_cents,note)
  VALUES (1,12,2026,6,7,420000,'BC Hydro June estimate, invoice not yet received');

INSERT INTO tenants (id,name,is_company,contact_name,contact_email) VALUES
  (1,'Blackwood & Associates LLP',1,'Sarah Blackwood','s.blackwood@blackwoodlaw.ca'),
  (2,'Cascade Digital Inc',1,'James Chen','j.chen@cascadedigital.ca');

INSERT INTO leases (id,suite_id,tenant_id,commencement_date,expiry_date,lease_type,base_rent_annual_cents) VALUES
  (1,1,1,'2024-01-01','2029-12-31','nnn',36000000),
  (2,2,2,'2025-03-01','2030-02-28','modified_gross',48600000);

INSERT INTO rent_steps (lease_id,effective_date,annual_rent_cents) VALUES
  (1,'2024-01-01',36000000),(1,'2025-01-01',37440000),(1,'2026-01-01',38937600),
  (2,'2025-03-01',48600000),(2,'2026-03-01',50058000);
