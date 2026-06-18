-- Demo data: Cordova Exchange, Q2 2026. Money in integer cents. Period 6 carries
-- the quarter figures. Run with `npm run seed`.
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

INSERT INTO vendors (id,name,default_gl_account_id,match_aliases,requires_work_confirmation) VALUES
  (1,'Pinnacle Roofing Ltd',11,'["Pinnacle Roofing","Pinnacle Roofing Ltd."]',1),
  (2,'BC Hydro',12,'["BC Hydro","British Columbia Hydro & Power Authority"]',0),
  (3,'Westcoast Janitorial',13,'["Westcoast Janitorial","West Coast Janitorial Inc"]',0),
  (4,'GreenBlade Landscaping',14,'["GreenBlade","GreenBlade Landscaping"]',1);

INSERT INTO budgets (building_id,gl_account_id,fiscal_year,period,amount_cents) VALUES
  (1,11,2026,6,1800000),(1,12,2026,6,2700000),(1,13,2026,6,1500000),(1,14,2026,6,900000),
  (1,21,2026,6,8400000),(1,22,2026,6,1200000),(1,23,2026,6,2100000),(1,24,2026,6,1350000);

-- Invoice 1 (PR-4471): in review with multi-line coding from the reader
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status,source) VALUES
  (1,1,1,'PR-4471','2026-06-15',2280000,'coded','upload');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents,coding_source,confidence) VALUES
  (1,11,'Tear-off and replace section B membrane',1950000,'vendor_default',NULL),
  (1,11,'Disposal & haul-away',210000,'ai_suggested',97),
  (1,11,'Emergency call-out fee',120000,'ai_suggested',61);

-- Paid invoices backing the budget-vs-actual view (period 6)
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status,source) VALUES
  (2,2,1,'HY-0091','2026-06-10',2110000,'paid','email'),
  (3,3,1,'WJ-220','2026-06-12',1425000,'paid','email'),
  (4,4,1,'GB-77','2026-06-08',1160000,'paid','email');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents,coding_source) VALUES
  (2,12,'Electricity — June',2110000,'vendor_default'),
  (3,13,'Monthly janitorial contract',1425000,'vendor_default'),
  (4,14,'Snow removal + grounds',1160000,'vendor_default');
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status) VALUES
  (5,1,1,'TAX-Q2','2026-06-01',8400000,'paid'),(6,1,1,'INS-26','2026-06-01',1245000,'paid'),
  (7,1,1,'MGMT-06','2026-06-01',2100000,'paid'),(8,1,1,'SEC-06','2026-06-01',1290000,'paid');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents) VALUES
  (5,21,'Property taxes Q2',8400000),(6,22,'Insurance premium',1245000),
  (7,23,'Management fee June',2100000),(8,24,'Security June',1290000);

-- Review queue invoices (period 7 so they don't touch period-6 budget numbers)
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status,source) VALUES
  (9,2,1,'HY-0095','2026-07-02',842000,'coded','email'),
  (10,4,1,'GB-82','2026-07-05',386600,'entered','email'),
  (11,3,1,'WJ-228','2026-07-03',475000,'entered','email');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents,coding_source) VALUES
  (9,12,'Electricity — July estimate',842000,'vendor_default'),
  (10,14,'July grounds maintenance',386600,'vendor_default'),
  (11,13,'Monthly janitorial — July',475000,'vendor_default');

INSERT INTO accruals (building_id,gl_account_id,fiscal_year,accrual_period,reverse_period,amount_cents,note)
  VALUES (1,12,2026,6,7,420000,'BC Hydro June estimate, invoice not yet received');

-- Import records (reader confidence)
INSERT INTO invoice_imports (source,source_ref,received_at,matched_vendor_id,confidence,status,invoice_id) VALUES
  ('upload','PR-4471.pdf','2026-06-15T09:30:00',1,96,'posted',1),
  ('email','msg-hy-0095','2026-07-02T08:15:00',2,92,'posted',9),
  ('email','msg-gb-82','2026-07-05T10:00:00',4,88,'posted',10),
  ('email','msg-wj-228','2026-07-03T11:20:00',3,94,'posted',11);

-- Tenants & leases for rent roll
INSERT INTO tenants (id,name,is_company,contact_name,contact_email) VALUES
  (1,'Blackwood & Associates LLP',1,'Sarah Blackwood','s.blackwood@blackwoodlaw.ca'),
  (2,'Cascade Digital Inc',1,'James Chen','j.chen@cascadedigital.ca');
INSERT INTO leases (id,suite_id,tenant_id,commencement_date,expiry_date,lease_type,base_rent_annual_cents) VALUES
  (1,1,1,'2024-01-01','2029-12-31','nnn',36000000),
  (2,2,2,'2025-03-01','2030-02-28','modified_gross',48600000);
INSERT INTO rent_steps (lease_id,effective_date,annual_rent_cents) VALUES
  (1,'2024-01-01',36000000),(1,'2025-01-01',37440000),(1,'2026-01-01',38937600),
  (2,'2025-03-01',48600000),(2,'2026-03-01',50058000);

-- Roles (ranked: lower rank = earlier in chain)
INSERT INTO roles (id,key,name,rank) VALUES
  (1,'building_manager','Building Manager',10),
  (2,'property_manager','Property Manager',20),
  (3,'controller','Controller',30),
  (4,'vp_finance','VP Finance',40);

-- Users with role_id FK
INSERT INTO users (id,name,email,role,role_id) VALUES
  (1,'J. Tran','j.tran@hastingsholdings.ca','Building Manager',1),
  (2,'S. Okafor','s.okafor@hastingsholdings.ca','Property Manager',2),
  (3,'M. Reyes','m.reyes@hastingsholdings.ca','Controller',3),
  (4,'D. Cho','d.cho@hastingsholdings.ca','VP Finance',4);

-- Approval rules: data-driven routing
--   1. Every invoice needs Building Manager + Property Manager
--   2. Invoices over $10,000 also need Controller
--   3. Budget overrun adds VP Finance
INSERT INTO approval_rules (id,scope,trigger_type,min_amount_cents,required_role_id,active) VALUES
  (1,'all','always',NULL,1,1),
  (2,'all','always',NULL,2,1),
  (3,'all','amount',1000000,3,1),
  (4,'all','budget_overrun',NULL,4,1);

-- Service contracts (replaces requires_work_confirmation boolean)
INSERT INTO service_contracts (vendor_id,building_id,gl_account_id,description,amount_cents,frequency,start_date,end_date,active) VALUES
  (1,1,11,'Roof maintenance & emergency repairs',0,'one_time','2026-01-01',NULL,1),
  (4,1,14,'Grounds maintenance & snow removal',386600,'monthly','2025-04-01','2026-12-31',1);

-- Vendor documents (insurance COI + banking)
INSERT INTO vendor_documents (vendor_id,doc_type,description,expiry_date,uploaded_at) VALUES
  (1,'insurance_coi','$5M general liability','2026-08-31','2025-03-10'),
  (1,'banking','TD chequing ****4821',NULL,'2025-03-10'),
  (2,'insurance_coi','$10M commercial general','2026-12-31','2025-01-05'),
  (2,'banking','RBC ****7733',NULL,'2025-01-05'),
  (3,'insurance_coi','$2M general liability','2026-05-31','2024-06-01'),
  (3,'banking','BMO ****9102',NULL,'2024-06-01'),
  (4,'insurance_coi','$3M general liability','2026-10-15','2025-04-20'),
  (4,'banking','Scotiabank ****5540',NULL,'2025-04-20');

-- Work confirmation for invoice 1 (PR-4471)
INSERT INTO work_confirmations (invoice_id,confirmed_by,confirmed_at,notes) VALUES
  (1,'J. Tran','2026-06-16','Photos and sign-off by J. Tran, Building Manager');

-- Approval decisions (persisted state for existing invoices; the chain itself
-- is generated from approval_rules at render time)
INSERT INTO approvals (invoice_id,user_id,step_order,status,reason,decided_at) VALUES
  (1,1,1,'approved','confirmed work complete','2026-06-16'),
  (1,2,2,'approved',NULL,'2026-06-17'),
  (1,3,3,'pending','required over $10,000',NULL),
  (1,4,4,'queued','added because the invoice exceeds budget',NULL);
INSERT INTO approvals (invoice_id,user_id,step_order,status,reason,decided_at) VALUES
  (9,2,1,'approved',NULL,'2026-07-03'),
  (9,3,2,'pending','standard review',NULL);
INSERT INTO approvals (invoice_id,user_id,step_order,status) VALUES
  (10,1,1,'queued'),
  (11,2,1,'queued');
