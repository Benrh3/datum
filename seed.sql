-- Demo data: Hastings Holdings Group portfolio, Q2 2026. Money in integer cents.
-- Period 6 carries the quarter figures. Run with `npm run seed`.
INSERT INTO orgs (id,name) VALUES (1,'Hastings Holdings Group');
INSERT INTO entities (id,name,legal_form,org_id) VALUES
  (1,'Hastings Holdings LP','LP',1),
  (2,'Bayside Properties Inc','Corp',1),
  (3,'Pacific Gate Capital','LP',1);

INSERT INTO buildings (id,entity_id,name,address,city,rentable_area_sqft) VALUES
  (1,1,'Cordova Exchange','525 W Cordova St','Vancouver',100000),
  (2,2,'Marine Gateway Tower','450 SW Marine Dr','Vancouver',75000),
  (3,2,'Granville Square','200 Granville St','Vancouver',52000),
  (4,2,'Harbour Centre','555 W Hastings St','Vancouver',120000),
  (5,2,'Waterfront Place','1055 Canada Pl','Vancouver',42000),
  (6,2,'Gastown Lofts','312 Water St','Vancouver',28000),
  (7,2,'Pacific Rim Plaza','1088 Burrard St','Vancouver',65000),
  (8,3,'Cambie Commons','4250 Cambie St','Vancouver',34000);
INSERT INTO suites (building_id,suite_number,floor,rentable_area_sqft,status) VALUES
  (1,'200',2,12000,'occupied'),(1,'300',3,18000,'occupied'),(1,'400',4,9000,'vacant'),
  (1,'500',5,15500,'occupied'),(1,'510',5,6200,'vacant'),
  (1,'600',6,14000,'occupied'),(1,'700',7,11800,'occupied'),(1,'800',8,13500,'occupied');

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

-- Expanded chart of accounts: ~150 codes across income, opex, capital, non-operating.
-- Three hierarchy levels: category (header) → account (header) → sub-account (postable).
-- Existing accounts (IDs 10–24) are untouched; new ones start at ID 100.

-- ── 4000 INCOME ──────────────────────────────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,sort_order) VALUES
  (100,'4000','Revenue','income',0,0,4000);
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (110,'4100','Rental income','income',0,0,100,4100),
  (111,'4110','Base rent — office','income',0,1,110,4110),
  (112,'4120','Base rent — retail','income',0,1,110,4120),
  (113,'4130','Percentage rent','income',0,1,110,4130),
  (114,'4140','Parking revenue','income',0,1,110,4140),
  (115,'4150','Storage income','income',0,1,110,4150),
  (116,'4160','Antenna & telecom leases','income',0,1,110,4160),
  (120,'4200','Recovery income','income',0,0,100,4200),
  (121,'4210','CAM recoveries','income',0,1,120,4210),
  (122,'4220','Tax recoveries','income',0,1,120,4220),
  (123,'4230','Insurance recoveries','income',0,1,120,4230),
  (124,'4240','Utility recoveries','income',0,1,120,4240),
  (130,'4300','Other income','income',0,0,100,4300),
  (131,'4310','Late fees & penalties','income',0,1,130,4310),
  (132,'4320','Interest income','income',0,1,130,4320),
  (133,'4330','Tenant event fees','income',0,1,130,4330),
  (134,'4340','Forfeited deposits','income',0,1,130,4340);

-- ── 5000 sub-accounts (third level under existing 5100–5400) ────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (140,'5110','General repairs','operating_expense',1,1,11,5110),
  (141,'5120','Painting & finishing','operating_expense',1,1,11,5120),
  (142,'5130','Doors & hardware','operating_expense',1,1,11,5130),
  (143,'5140','Flooring','operating_expense',1,1,11,5140),
  (144,'5150','Roof repairs (minor)','operating_expense',1,1,11,5150),
  (145,'5160','Plumbing repairs','operating_expense',1,1,11,5160),
  (146,'5170','Electrical repairs','operating_expense',1,1,11,5170),
  (150,'5210','Electricity','operating_expense',1,1,12,5210),
  (151,'5220','Natural gas','operating_expense',1,1,12,5220),
  (152,'5230','Water & sewer','operating_expense',1,1,12,5230),
  (153,'5240','Waste disposal','operating_expense',1,1,12,5240),
  (160,'5310','Day porter service','operating_expense',1,1,13,5310),
  (161,'5320','Night cleaning','operating_expense',1,1,13,5320),
  (162,'5330','Cleaning supplies','operating_expense',1,1,13,5330),
  (163,'5340','Window cleaning','operating_expense',1,1,13,5340),
  (170,'5410','Grounds maintenance','operating_expense',1,1,14,5410),
  (171,'5420','Snow removal','operating_expense',1,1,14,5420),
  (172,'5430','Irrigation','operating_expense',1,1,14,5430);

-- ── 5000 new second-level accounts ──────────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (180,'5500','Life safety','operating_expense',1,0,10,5500),
  (181,'5510','Fire alarm maintenance','operating_expense',1,1,180,5510),
  (182,'5520','Sprinkler inspection','operating_expense',1,1,180,5520),
  (183,'5530','Emergency generator','operating_expense',1,1,180,5530),
  (184,'5540','Emergency lighting','operating_expense',1,1,180,5540),
  (190,'5600','Building systems','operating_expense',1,0,10,5600),
  (191,'5610','Elevator maintenance','operating_expense',1,1,190,5610),
  (192,'5620','HVAC preventive maintenance','operating_expense',1,1,190,5620),
  (193,'5630','Building automation','operating_expense',1,1,190,5630),
  (194,'5640','Plumbing systems','operating_expense',1,1,190,5640),
  (195,'5650','Electrical systems','operating_expense',1,1,190,5650),
  (200,'5700','Tenant services','operating_expense',1,0,10,5700),
  (201,'5710','Signage','operating_expense',1,1,200,5710),
  (202,'5720','After-hours HVAC','operating_expense',1,1,200,5720),
  (203,'5730','Pest control','operating_expense',1,1,200,5730),
  (204,'5740','Parking operations','operating_expense',1,1,200,5740);

-- ── 6000 sub-accounts + new second-level ────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (210,'6210','Property insurance','operating_expense',0,1,22,6210),
  (211,'6220','General liability','operating_expense',0,1,22,6220),
  (212,'6230','Umbrella policy','operating_expense',0,1,22,6230),
  (213,'6240','Environmental insurance','operating_expense',0,1,22,6240),
  (220,'6410','Guard service','operating_expense',1,1,24,6410),
  (221,'6420','Access control systems','operating_expense',1,1,24,6420),
  (222,'6430','CCTV & monitoring','operating_expense',1,1,24,6430),
  (230,'6500','Administrative','operating_expense',0,0,20,6500),
  (231,'6510','Office supplies','operating_expense',0,1,230,6510),
  (232,'6520','Telecommunications','operating_expense',0,1,230,6520),
  (233,'6530','Legal fees','operating_expense',0,1,230,6530),
  (234,'6540','Accounting & audit','operating_expense',0,1,230,6540),
  (235,'6550','Licenses & permits','operating_expense',0,1,230,6550),
  (236,'6560','Bank charges','operating_expense',0,1,230,6560),
  (237,'6570','Postage & courier','operating_expense',0,1,230,6570),
  (240,'6600','Marketing & leasing','operating_expense',0,0,20,6600),
  (241,'6610','Leasing commissions','operating_expense',0,1,240,6610),
  (242,'6620','Marketing & advertising','operating_expense',0,1,240,6620),
  (243,'6630','Tenant retention','operating_expense',0,1,240,6630),
  (244,'6640','Broker incentives','operating_expense',0,1,240,6640),
  (250,'6700','Professional services','operating_expense',0,0,20,6700),
  (251,'6710','Property appraisal','operating_expense',0,1,250,6710),
  (252,'6720','Environmental assessment','operating_expense',0,1,250,6720),
  (253,'6730','Engineering consulting','operating_expense',0,1,250,6730),
  (254,'6740','Survey & inspection','operating_expense',0,1,250,6740);

-- ── 7000 CAPITAL ────────────────────────────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,sort_order) VALUES
  (300,'7000','Capital expenditures','capital',0,0,7000);
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (310,'7100','Tenant improvements','capital',0,0,300,7100),
  (311,'7110','TI allowance — new leases','capital',0,1,310,7110),
  (312,'7120','TI allowance — renewals','capital',0,1,310,7120),
  (313,'7130','Building standard finish','capital',0,1,310,7130),
  (320,'7200','Building improvements','capital',0,0,300,7200),
  (321,'7210','Roof replacement','capital',0,1,320,7210),
  (322,'7220','Parking & paving','capital',0,1,320,7220),
  (323,'7230','Lobby & common area','capital',0,1,320,7230),
  (324,'7240','Facade & envelope','capital',0,1,320,7240),
  (325,'7250','Washroom renovation','capital',0,1,320,7250),
  (326,'7260','Window replacement','capital',0,1,320,7260),
  (330,'7300','Equipment & systems','capital',0,0,300,7300),
  (331,'7310','HVAC replacement','capital',0,1,330,7310),
  (332,'7320','Elevator modernization','capital',0,1,330,7320),
  (333,'7330','Life safety upgrade','capital',0,1,330,7330),
  (334,'7340','Electrical upgrade','capital',0,1,330,7340),
  (335,'7350','BAS/controls upgrade','capital',0,1,330,7350),
  (340,'7400','Environmental','capital',0,0,300,7400),
  (341,'7410','Asbestos abatement','capital',0,1,340,7410),
  (342,'7420','Environmental remediation','capital',0,1,340,7420),
  (343,'7430','Energy retrofit','capital',0,1,340,7430),
  (350,'7500','Technology','capital',0,0,300,7500),
  (351,'7510','Network infrastructure','capital',0,1,350,7510),
  (352,'7520','Building wifi','capital',0,1,350,7520),
  (353,'7530','Tenant portal','capital',0,1,350,7530),
  (354,'7540','Smart building sensors','capital',0,1,350,7540);

-- ── 8000 NON-OPERATING ──────────────────────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,sort_order) VALUES
  (400,'8000','Non-operating','operating_expense',0,0,8000);
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (410,'8100','Debt service','operating_expense',0,0,400,8100),
  (411,'8110','Mortgage interest','operating_expense',0,1,410,8110),
  (412,'8120','Mortgage principal','operating_expense',0,1,410,8120),
  (413,'8130','Line of credit interest','operating_expense',0,1,410,8130),
  (420,'8200','Reserves','capital',0,0,400,8200),
  (421,'8210','Replacement reserve','capital',0,1,420,8210),
  (422,'8220','Structural reserve','capital',0,1,420,8220),
  (423,'8230','Environmental reserve','capital',0,1,420,8230),
  (430,'8300','Distributions','operating_expense',0,0,400,8300),
  (431,'8310','Owner distributions','operating_expense',0,1,430,8310),
  (432,'8320','Partner draws','operating_expense',0,1,430,8320);

-- ── 9000 TAX ────────────────────────────────────────────────────
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,sort_order) VALUES
  (500,'9000','Tax accounts','tax',0,0,9000);
INSERT INTO gl_accounts (id,code,name,account_type,is_recoverable,is_postable,parent_id,sort_order) VALUES
  (501,'9100','Income tax provision','tax',0,1,500,9100),
  (502,'9200','Property transfer tax','tax',0,1,500,9200),
  (503,'9300','GST/HST payable','tax',0,1,500,9300),
  (504,'9400','Provincial sales tax','tax',0,1,500,9400);

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
  (2,'Cascade Digital Inc',1,'James Chen','j.chen@cascadedigital.ca'),
  (3,'Pacific Rim Consulting Group',1,'Anita Sharma','a.sharma@pacificrimcg.ca'),
  (4,'Northshore Wealth Management',1,'David Park','d.park@northshorewealth.ca'),
  (5,'Tidewater Architecture + Design',1,'Emma Liu','e.liu@tidewaterarch.ca'),
  (6,'Apex Ventures Corp',1,'Marcus Webb','m.webb@apexventures.ca');
INSERT INTO leases (id,suite_id,tenant_id,commencement_date,expiry_date,lease_type,base_rent_annual_cents) VALUES
  (1,1,1,'2024-01-01','2029-12-31','nnn',36000000),
  (2,2,2,'2025-03-01','2030-02-28','modified_gross',48600000),
  (3,4,3,'2023-07-01','2028-06-30','nnn',49600000),
  (4,6,4,'2024-09-01','2029-08-31','modified_gross',49000000),
  (5,7,5,'2025-01-01','2029-12-31','nnn',33040000),
  (6,8,6,'2022-04-01','2027-03-31','modified_gross',51300000);
INSERT INTO rent_steps (lease_id,effective_date,annual_rent_cents) VALUES
  (1,'2024-01-01',36000000),(1,'2025-01-01',37440000),(1,'2026-01-01',38937600),
  (2,'2025-03-01',48600000),(2,'2026-03-01',50058000),
  (3,'2023-07-01',49600000),(3,'2024-07-01',51088000),(3,'2025-07-01',52621000),
  (4,'2024-09-01',49000000),(4,'2025-09-01',50470000),
  (5,'2025-01-01',33040000),(5,'2026-01-01',34031000),
  (6,'2022-04-01',51300000),(6,'2023-04-01',52839000),(6,'2024-04-01',54424000),
  (6,'2025-04-01',56057000),(6,'2026-04-01',57739000);

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

-- Sample reclassification: invoice 6 (insurance) had a line miscoded to 5100 R&M,
-- reclassified to 6200 Insurance after posting
INSERT INTO reclassifications (invoice_line_id, invoice_id, from_gl_account_id, to_gl_account_id, amount_cents, reason, user_id, created_at)
  VALUES (8, 6, 11, 22, 1245000, 'Originally miscoded to R&M — should be Insurance premium', 2, '2026-06-03');
INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id, created_at)
  VALUES ('reclassifications', 1, 'reclass_posted', '{"gl_account_id":11,"code":"5100"}', '{"gl_account_id":22,"code":"6200","reason":"Originally miscoded to R&M"}', 2, '2026-06-03');

-- Portfolio ownership (entity A=1 bldg, B=5 sole + 40% shared, C=60% shared + 1 sole)
INSERT INTO building_ownership (building_id,entity_id,ownership_bps) VALUES
  (1,1,10000),
  (2,2,10000),(3,2,10000),(4,2,10000),(5,2,10000),(6,2,10000),
  (7,2,4000),(7,3,6000),
  (8,3,10000);

-- Budgets for other buildings (minimal, for the owner-statement report)
INSERT INTO budgets (building_id,gl_account_id,fiscal_year,period,amount_cents) VALUES
  (2,11,2026,6,1500000),(2,12,2026,6,2200000),(2,21,2026,6,7000000),(2,23,2026,6,1800000),
  (3,11,2026,6,800000),(3,12,2026,6,1400000),(3,21,2026,6,4200000),(3,23,2026,6,1100000),
  (4,11,2026,6,2400000),(4,12,2026,6,3600000),(4,21,2026,6,10800000),(4,23,2026,6,2800000),
  (7,11,2026,6,1200000),(7,12,2026,6,1800000),(7,21,2026,6,5500000),(7,23,2026,6,1400000);

-- Paid invoices for buildings 2, 4, 7 (so the owner statement shows real actuals)
INSERT INTO invoices (id,vendor_id,building_id,invoice_number,invoice_date,total_cents,status) VALUES
  (12,1,2,'MG-TAX-Q2','2026-06-01',7200000,'paid'),
  (13,1,2,'MG-MGMT-06','2026-06-01',1720000,'paid'),
  (14,1,4,'HC-TAX-Q2','2026-06-01',11200000,'paid'),
  (15,1,4,'HC-MGMT-06','2026-06-01',2650000,'paid'),
  (16,1,7,'PR-TAX-Q2','2026-06-01',5800000,'paid'),
  (17,1,7,'PR-MGMT-06','2026-06-01',1350000,'paid');
INSERT INTO invoice_lines (invoice_id,gl_account_id,description,amount_cents) VALUES
  (12,21,'Property taxes Q2 — Marine Gateway',7200000),
  (13,23,'Management fee June — Marine Gateway',1720000),
  (14,21,'Property taxes Q2 — Harbour Centre',11200000),
  (15,23,'Management fee June — Harbour Centre',2650000),
  (16,21,'Property taxes Q2 — Pacific Rim',5800000),
  (17,23,'Management fee June — Pacific Rim',1350000);

-- Bank accounts: operating per entity, trust + security deposit for key buildings
INSERT INTO bank_accounts (id,entity_id,building_id,type,name,last4) VALUES
  (1,1,NULL,'operating','Hastings Holdings LP — Operating','4821'),
  (2,2,NULL,'operating','Bayside Properties — Operating','7733'),
  (3,3,NULL,'operating','Pacific Gate Capital — Operating','5540'),
  (4,1,1,'trust','Cordova Exchange — Trust','9201'),
  (5,1,1,'security_deposit','Cordova Exchange — Security Deposits','9202'),
  (6,2,4,'trust','Harbour Centre — Trust','3310'),
  (7,2,7,'trust','Pacific Rim Plaza — Trust','3311'),
  (8,3,8,'security_deposit','Cambie Commons — Security Deposits','8801');

-- Link paid invoices to their entity's operating account
UPDATE invoices SET paid_from_bank_account_id = 1 WHERE building_id = 1 AND status = 'paid';
UPDATE invoices SET paid_from_bank_account_id = 2 WHERE building_id IN (2,3,4,5,6,7) AND status = 'paid';
UPDATE invoices SET paid_from_bank_account_id = 3 WHERE building_id = 8 AND status = 'paid';
