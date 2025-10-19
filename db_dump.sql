PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guest',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
INSERT INTO users VALUES(1,'admin','$2a$10$L0R7.FOCjb/.P8n7JAvEk.YWWwMq8UuHmHfsWQkZhou2AoTSqEDHy','admin','2025-10-03 20:19:02');
CREATE TABLE content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      filepath TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      collection TEXT,
      hidden BOOLEAN DEFAULT 0,
      downloadable BOOLEAN DEFAULT 1,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
INSERT INTO content VALUES(2,'1759541984355-753134061-Web-Rendered_Retouched-136 copy.jpeg','Web-Rendered_Retouched-136 copy.jpeg','content/1759541984355-753134061-Web-Rendered_Retouched-136 copy.jpeg','image','image/jpeg',919588,NULL,0,1,NULL,'2025-10-04 01:39:44','2025-10-04 01:39:44');
INSERT INTO content VALUES(3,'1759542791229-578145675-Coldfire Brewing - Arch Hat - Mineral - MOCKUP.pdf','Coldfire Brewing - Arch Hat - Mineral - MOCKUP.pdf','content/1759542791229-578145675-Coldfire Brewing - Arch Hat - Mineral - MOCKUP.pdf','pdf','application/pdf',280347,'Media',0,1,NULL,'2025-10-04 01:53:11','2025-10-05 14:40:19');
INSERT INTO content VALUES(4,'1759547460974-208612891-adde8ea5e4ed30fd24e50f5089730525f2db243a.mov','adde8ea5e4ed30fd24e50f5089730525f2db243a.mov','content/1759547460974-208612891-adde8ea5e4ed30fd24e50f5089730525f2db243a.mov','video','video/quicktime',19685640,'Media',0,1,NULL,'2025-10-04 03:11:01','2025-10-04 03:11:01');
INSERT INTO content VALUES(5,'1759606802942-773246949-368fc90db6a97ef41a8ba5395c0e140f8e04bfba.mov','printing','content/1759606802942-773246949-368fc90db6a97ef41a8ba5395c0e140f8e04bfba.mov','video','video/quicktime',4240888,'Media',0,1,NULL,'2025-10-04 19:40:02','2025-10-05 19:10:33');
INSERT INTO content VALUES(6,'1759617741142-118198303-d6db9bc77919879e34b572a9c94c4a59ff9ad738.mov','d6db9bc77919879e34b572a9c94c4a59ff9ad738.mov','content/1759617741142-118198303-d6db9bc77919879e34b572a9c94c4a59ff9ad738.mov','video','video/quicktime',15864394,'Media',0,1,NULL,'2025-10-04 22:42:21','2025-10-04 22:42:21');
INSERT INTO content VALUES(7,'1760240390627-546721584-Hold-Music.mp3','Hold-Music.mp3','content/1760240390627-546721584-Hold-Music.mp3','audio','audio/mpeg',2404845,'Music',0,1,NULL,'2025-10-12 03:39:50','2025-10-12 03:39:50');
CREATE TABLE zim_libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      title TEXT,
      description TEXT,
      language TEXT,
      size INTEGER,
      article_count INTEGER,
      media_count INTEGER,
      url TEXT,
      hidden BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , last_checked_at DATETIME, available_update_url TEXT, available_update_version TEXT, available_update_size INTEGER, auto_update_enabled BOOLEAN DEFAULT 0, updated_date TEXT, available_update_date TEXT, available_update_article_count INTEGER, available_update_media_count INTEGER, status TEXT DEFAULT 'active', error_message TEXT, download_method TEXT DEFAULT 'http', torrent_info_hash TEXT);
INSERT INTO zim_libraries VALUES(37,'pets.stackexchange.com_en_all_2025-08.zim','/Users/nate/Documents/SafeHarbor/zim/pets.stackexchange.com_en_all_2025-08.zim','Pets Q&amp;A','Stack Exchange Q&amp;A for pet owners, caretakers, breeders, veterinarians, trainers','eng',78742285,16230,2288,'https://download.kiwix.org/zim/stack_exchange/pets.stackexchange.com_en_all_2025-08.zim',0,'2025-10-12 22:45:02',NULL,NULL,NULL,NULL,0,'2025-08-27T00:00:00Z',NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(38,'devdocs_en_node_2025-10.zim','/Users/nate/Documents/SafeHarbor/zim/devdocs_en_node_2025-10.zim','Node.js Docs','Node.js documentation, by DevDocs','eng',778901,47,NULL,'https://download.kiwix.org/zim/devdocs/devdocs_en_node_2025-10.zim',0,'2025-10-12 22:45:47',NULL,NULL,NULL,NULL,0,'2025-10-06T00:00:00Z',NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(39,'restarters_en_all_maxi_2025-07.zim','/Users/nate/Documents/SafeHarbor/zim/restarters_en_all_maxi_2025-07.zim','restarters en all maxi 2025-07','Metadata not found in catalog',NULL,5860224,NULL,NULL,'https://download.kiwix.org/zim/other/restarters_en_all_maxi_2025-07.zim',0,'2025-10-12 22:45:49',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(40,'php.net_en_all_2024-08.zim','/Users/nate/Documents/SafeHarbor/zim/php.net_en_all_2024-08.zim','PHP Manual','PHP Manual','eng',32847118,11604,76,'https://download.kiwix.org/zim/zimit/php.net_en_all_2024-08.zim',0,'2025-10-12 22:46:10',NULL,NULL,NULL,NULL,0,'2024-08-13T00:00:00Z',NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(41,'fas-military-medicine_en_2025-06.zim','/Users/nate/Documents/SafeHarbor/zim/fas-military-medicine_en_2025-06.zim','fas-military-medicine en 2025-06','Metadata not found in catalog',NULL,81455189,NULL,NULL,'https://download.kiwix.org/zim/zimit/fas-military-medicine_en_2025-06.zim',0,'2025-10-12 22:46:33',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(43,'prunelle_en_budding-authors_2025-02.zim','/Users/nate/Documents/SafeHarbor/zim/prunelle_en_budding-authors_2025-02.zim','prunelle en budding-authors 2025-02',NULL,NULL,307399556,NULL,NULL,NULL,0,'2025-10-12 22:58:04',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(44,'openstreetmap-wiki_en_all_maxi_2025-07.zim','/Users/nate/Documents/SafeHarbor/zim/openstreetmap-wiki_en_all_maxi_2025-07.zim','openstreetmap-wiki en all maxi 2025-07',NULL,NULL,867198106,NULL,NULL,NULL,0,'2025-10-12 22:58:10',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,'active',NULL,'torrent',NULL);
INSERT INTO zim_libraries VALUES(45,'zimgit-post-disaster_en_2024-05.zim','/Users/nate/Documents/SafeHarbor/zim/zimgit-post-disaster_en_2024-05.zim','zimgit-post-disaster en 2024-05',NULL,NULL,644665513,NULL,NULL,NULL,0,'2025-10-12 22:58:12',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,'active',NULL,'torrent',NULL);
CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , hidden BOOLEAN DEFAULT 0);
INSERT INTO collections VALUES(1,'Medical',NULL,NULL,'2025-10-03 20:19:02',0);
INSERT INTO collections VALUES(2,'Books',NULL,NULL,'2025-10-03 20:19:02',0);
INSERT INTO collections VALUES(3,'Survival',NULL,NULL,'2025-10-03 20:19:02',0);
INSERT INTO collections VALUES(4,'Education',NULL,NULL,'2025-10-03 20:19:02',0);
INSERT INTO collections VALUES(5,'Media',NULL,NULL,'2025-10-03 20:19:02',0);
INSERT INTO collections VALUES(202,'Other Books',NULL,NULL,'2025-10-04 22:28:47',0);
INSERT INTO collections VALUES(217,'Literature',NULL,NULL,'2025-10-04 22:34:01',0);
INSERT INTO collections VALUES(2041,'Music',NULL,NULL,'2025-10-12 03:39:44',0);
CREATE TABLE network_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL DEFAULT 'hotspot',
      hotspot_ssid TEXT,
      hotspot_password TEXT,
      hotspot_open BOOLEAN DEFAULT 0,
      connection_limit INTEGER DEFAULT 10,
      home_network_ssid TEXT,
      home_network_password TEXT,
      captive_portal BOOLEAN DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
INSERT INTO network_config VALUES(1,'hotspot','SafeHarbor','safeharbor2024',0,10,NULL,NULL,0,'2025-10-03 20:19:02');
CREATE TABLE system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
INSERT INTO system_settings VALUES('torrent_default_method','torrent','2025-10-12 20:50:59');
INSERT INTO system_settings VALUES('torrent_seed_enabled','true','2025-10-12 20:50:59');
INSERT INTO system_settings VALUES('torrent_seed_duration_hours','24','2025-10-12 20:50:59');
INSERT INTO system_settings VALUES('torrent_max_upload_speed','1048576','2025-10-12 20:50:59');
INSERT INTO system_settings VALUES('auto_index_new_zims','true','2025-10-12 23:00:31');
CREATE TABLE search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER,
      zim_id INTEGER,
      title TEXT,
      content TEXT,
      keywords TEXT, file_type TEXT, collection TEXT, language TEXT,
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE
    );
INSERT INTO search_index VALUES(2,2,NULL,'Web-Rendered_Retouched-136 copy.jpeg','','image',NULL,NULL,NULL);
INSERT INTO search_index VALUES(3,3,NULL,'Coldfire Brewing - Arch Hat - Mineral - MOCKUP.pdf','','pdf',NULL,NULL,NULL);
INSERT INTO search_index VALUES(4,4,NULL,'adde8ea5e4ed30fd24e50f5089730525f2db243a.mov','','other',NULL,NULL,NULL);
INSERT INTO search_index VALUES(5,5,NULL,'printing','','other',NULL,NULL,NULL);
INSERT INTO search_index VALUES(6,6,NULL,'d6db9bc77919879e34b572a9c94c4a59ff9ad738.mov','','video',NULL,NULL,NULL);
INSERT INTO search_index VALUES(7,7,NULL,'Hold-Music.mp3','','audio',NULL,NULL,NULL);
PRAGMA writable_schema=ON;
INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table','search_fts','search_fts',0,'CREATE VIRTUAL TABLE search_fts USING fts5(
      title,
      content,
      keywords,
      content=''search_index'',
      content_rowid=''id''
    )');
CREATE TABLE IF NOT EXISTS 'search_fts_data'(id INTEGER PRIMARY KEY, block BLOB);
INSERT INTO search_fts_data VALUES(1,X'071e0007');
INSERT INTO search_fts_data VALUES(10,X'000000000109090009010101020101030101040101050101060101070101080101090101');
INSERT INTO search_fts_data VALUES(137438953473,X'000000500330313401020602043533333501020501066d6f636b757001020801096e617468616e61656c01020201036f64610102030201720102040103706466010809010202020565707065720102070407090b0e08060b');
INSERT INTO search_fts_data VALUES(274877906945,X'0000004b04303133360202050104636f70790202060105696d616765020601020201046a706567020207010872656e64657265640202030307746f756368656402020401037765620202020408090c090d0c');
INSERT INTO search_fts_data VALUES(412316860417,X'0000004f053061726368030204010762726577696e670302030108636f6c6466697265030202010368617403020501076d696e6572616c03020602056f636b7570030207010370646603080801020204090c0d080c0a');
INSERT INTO search_fts_data VALUES(549755813889,X'0000004529306164646538656135653465643330666432346535306635303839373330353235663264623234336104020201036d6f7604020301056f746865720406010202042d08');
INSERT INTO search_fts_data VALUES(687194767361,X'0000004529303336386663393064623661393765663431613862613533393563306531343066386530346266626105020201036d6f7605020301056f746865720506010202042d08');
INSERT INTO search_fts_data VALUES(824633720833,X'0000001d06306f74686572050701020201087072696e74696e67050302040c');
INSERT INTO search_fts_data VALUES(962072674305,X'0000004529306436646239626337373931393837396533346235373261396339346334613539666639616437333806020201036d6f760602030105766964656f0606010202042d08');
INSERT INTO search_fts_data VALUES(1099511627777,X'0000004f053061726368030304010762726577696e670303030108636f6c6466697265030302010368617403030501076d696e6572616c03030602056f636b7570030307010370646603090801020204090c0d080c0a');
INSERT INTO search_fts_data VALUES(1236950581249,X'0000002a0630617564696f07060102020104686f6c6407020201036d7033070204020475736963070203040c0908');
CREATE TABLE IF NOT EXISTS 'search_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
INSERT INTO search_fts_idx VALUES(1,X'',2);
INSERT INTO search_fts_idx VALUES(2,X'',2);
INSERT INTO search_fts_idx VALUES(3,X'',2);
INSERT INTO search_fts_idx VALUES(4,X'',2);
INSERT INTO search_fts_idx VALUES(5,X'',2);
INSERT INTO search_fts_idx VALUES(6,X'',2);
INSERT INTO search_fts_idx VALUES(7,X'',2);
INSERT INTO search_fts_idx VALUES(8,X'',2);
INSERT INTO search_fts_idx VALUES(9,X'',2);
CREATE TABLE IF NOT EXISTS 'search_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
INSERT INTO search_fts_docsize VALUES(1,X'080001');
INSERT INTO search_fts_docsize VALUES(2,X'060001');
INSERT INTO search_fts_docsize VALUES(3,X'070001');
INSERT INTO search_fts_docsize VALUES(4,X'020001');
INSERT INTO search_fts_docsize VALUES(5,X'010001');
INSERT INTO search_fts_docsize VALUES(6,X'020001');
INSERT INTO search_fts_docsize VALUES(7,X'030001');
CREATE TABLE IF NOT EXISTS 'search_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;
INSERT INTO search_fts_config VALUES('version',4);
CREATE TABLE zim_update_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      check_interval_hours INTEGER DEFAULT 24,
      auto_download_enabled BOOLEAN DEFAULT 0,
      min_space_buffer_gb REAL DEFAULT 5.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , download_start_hour INTEGER DEFAULT 2, download_end_hour INTEGER DEFAULT 6);
INSERT INTO zim_update_settings VALUES(1,24,0,5.0,'2025-10-12 22:40:19',2,6);
CREATE TABLE zim_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      zim_title TEXT,
      zim_filename TEXT,
      zim_id INTEGER,
      details TEXT,
      user_id INTEGER,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      file_size INTEGER,
      download_duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE SET NULL
    );
INSERT INTO zim_logs VALUES(101,'download_started','Pets Q&amp;A','pets.stackexchange.com_en_all_2025-08.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/stack_exchange/pets.stackexchange.com_en_all_2025-08.zim, Size: 0.07 GB',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:44:51');
INSERT INTO zim_logs VALUES(102,'download_completed','Pets Q&amp;A','pets.stackexchange.com_en_all_2025-08.zim',37,'Torrent download - Language: eng, Articles: 16,230',1,'success',NULL,78742285,11,'2025-10-12 22:45:02');
INSERT INTO zim_logs VALUES(103,'download_started','prunelle en budding-authors 2025-02','prunelle_en_budding-authors_2025-02.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/other/prunelle_en_budding-authors_2025-02.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:41');
INSERT INTO zim_logs VALUES(104,'download_started','fas-military-medicine en 2025-06','fas-military-medicine_en_2025-06.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/zimit/fas-military-medicine_en_2025-06.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(105,'download_started','Node.js Docs','devdocs_en_node_2025-10.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/devdocs/devdocs_en_node_2025-10.zim, Size: 0.00 GB',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(106,'download_started','openstreetmap-wiki en all maxi 2025-07','openstreetmap-wiki_en_all_maxi_2025-07.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/other/openstreetmap-wiki_en_all_maxi_2025-07.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(107,'download_started','PHP Manual','php.net_en_all_2024-08.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/zimit/php.net_en_all_2024-08.zim, Size: 0.03 GB',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(108,'download_started','zimgit-post-disaster en 2024-05','zimgit-post-disaster_en_2024-05.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/other/zimgit-post-disaster_en_2024-05.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(109,'download_started','www.ready.gov en 2024-12','www.ready.gov_en_2024-12.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/zimit/www.ready.gov_en_2024-12.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(110,'download_started','restarters en all maxi 2025-07','restarters_en_all_maxi_2025-07.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/other/restarters_en_all_maxi_2025-07.zim, Size: Unknown',1,'in_progress',NULL,NULL,NULL,'2025-10-12 22:45:42');
INSERT INTO zim_logs VALUES(111,'download_completed','Node.js Docs','devdocs_en_node_2025-10.zim',38,'Torrent download - Language: eng, Articles: 47',1,'success',NULL,778901,6,'2025-10-12 22:45:47');
INSERT INTO zim_logs VALUES(112,'download_completed','restarters en all maxi 2025-07','restarters_en_all_maxi_2025-07.zim',39,'Torrent download - Language: Unknown, Articles: N/A',1,'success',NULL,5860224,7,'2025-10-12 22:45:49');
INSERT INTO zim_logs VALUES(113,'download_completed','PHP Manual','php.net_en_all_2024-08.zim',40,'Torrent download - Language: eng, Articles: 11,604',1,'success',NULL,32847118,28,'2025-10-12 22:46:10');
INSERT INTO zim_logs VALUES(114,'download_completed','fas-military-medicine en 2025-06','fas-military-medicine_en_2025-06.zim',41,'Torrent download - Language: Unknown, Articles: N/A',1,'success',NULL,81455189,51,'2025-10-12 22:46:33');
INSERT INTO zim_logs VALUES(115,'download_completed','www.ready.gov en 2024-12','www.ready.gov_en_2024-12.zim',NULL,'Torrent download - Language: Unknown, Articles: N/A',1,'success',NULL,2429921822,181,'2025-10-12 22:48:43');
INSERT INTO zim_logs VALUES(116,'zim_deleted','www.ready.gov en 2024-12','www.ready.gov_en_2024-12.zim',NULL,'Size: 2.26 GB, Language: Unknown',1,'success',NULL,NULL,NULL,'2025-10-12 22:59:54');
INSERT INTO zim_logs VALUES(117,'download_started','Ready.gov','www.ready.gov_en_2024-12.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/zimit/www.ready.gov_en_2024-12.zim, Size: 2.26 GB',1,'in_progress',NULL,NULL,NULL,'2025-10-12 23:00:14');
INSERT INTO zim_logs VALUES(118,'download_completed','Ready.gov','www.ready.gov_en_2024-12.zim',NULL,'Torrent download - Language: eng, Articles: 2,437',1,'success',NULL,2429921822,102,'2025-10-12 23:01:56');
INSERT INTO zim_logs VALUES(119,'metadata_updated','Ready.gov','www.ready.gov_en_2024-12.zim',NULL,'status: "quarantined" → "active", error cleared',1,'success',NULL,NULL,NULL,'2025-10-12 23:10:19');
INSERT INTO zim_logs VALUES(120,'zim_deleted','Ready.gov','www.ready.gov_en_2024-12.zim',NULL,'Size: 2.26 GB, Language: eng',1,'success',NULL,NULL,NULL,'2025-10-12 23:11:15');
INSERT INTO zim_logs VALUES(121,'download_started','Ready.gov','www.ready.gov_en_2024-12.zim',NULL,'Method: torrent, URL: https://download.kiwix.org/zim/zimit/www.ready.gov_en_2024-12.zim, Size: 2.26 GB',1,'in_progress',NULL,NULL,NULL,'2025-10-12 23:11:38');
INSERT INTO zim_logs VALUES(122,'download_completed','Ready.gov','www.ready.gov_en_2024-12.zim',47,'Torrent download - Language: eng, Articles: 2,437',1,'success',NULL,2429921822,71,'2025-10-12 23:12:50');
CREATE TABLE zim_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zim_id INTEGER NOT NULL,
      article_url TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      snippet TEXT,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zim_id) REFERENCES zim_libraries(id) ON DELETE CASCADE,
      UNIQUE(zim_id, article_url)
    );
INSERT INTO zim_articles VALUES(15234,37,'images/7a17ebce0cbf0bbdc4800b163ea949d9.webp','7a17ebce0cbf0bbdc4800b163ea949d9.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15235,37,'images/7a19eef7c92b86b643d1b038a9618b4f.webp','7a19eef7c92b86b643d1b038a9618b4f.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15236,37,'images/7a4f75eeccbd674f9b98db51504f9e70.webp','7a4f75eeccbd674f9b98db51504f9e70.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15237,37,'images/7a822771de26176960dfdf8938bcd8ec.webp','7a822771de26176960dfdf8938bcd8ec.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15238,37,'images/7a98d916bdd08cf1dd4bb3e154e36511.webp','7a98d916bdd08cf1dd4bb3e154e36511.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15239,37,'images/7ab78affd63f73239bc986c353477ff3.webp','7ab78affd63f73239bc986c353477ff3.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15240,37,'images/7b4e8bda6e7f9a7757631459e909431f.webp','7b4e8bda6e7f9a7757631459e909431f.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15241,37,'images/7b5704b83f128342944821f5d855c83b.webp','7b5704b83f128342944821f5d855c83b.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15242,37,'images/7b5f77e7c05d2fd20e6ddd7577c11d83.webp','7b5f77e7c05d2fd20e6ddd7577c11d83.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15243,37,'images/7b813738c851ec1a69b595f0e79f15b4.webp','7b813738c851ec1a69b595f0e79f15b4.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15244,37,'images/7b99c8f14d9c61c694a517d85c281343.webp','7b99c8f14d9c61c694a517d85c281343.webp','','','2025-10-12 22:45:05');
INSERT INTO zim_articles VALUES(15245,37,'images/7ba1d5825ac3dc20c2c6607d1e06fb54.webp','7ba1d5825ac3dc20c2c6607d1e06fb54.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15246,37,'images/7bb4242ddd413add21a7eb1782dbc9b7.webp','7bb4242ddd413add21a7eb1782dbc9b7.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15247,37,'images/7bb527938b2fc34d73b832f7ebc1fd60.webp','7bb527938b2fc34d73b832f7ebc1fd60.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15248,37,'images/7bba5506ef5953ec981f9f29ff295488.webp','7bba5506ef5953ec981f9f29ff295488.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15249,37,'images/7bcd5c29d01fcda33be418d1db794946.webp','7bcd5c29d01fcda33be418d1db794946.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15250,37,'images/7bcec75006d4cc88ea756a75d49b0273.webp','7bcec75006d4cc88ea756a75d49b0273.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15251,37,'images/7c00cfc6ced55c1f8b69068f2b059825.webp','7c00cfc6ced55c1f8b69068f2b059825.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15252,37,'images/7c12bdf9b1ff7aa4d5d662896d5a8c72.webp','7c12bdf9b1ff7aa4d5d662896d5a8c72.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15253,37,'images/7c368f2a49fc97c63fbdb93123855d91.webp','7c368f2a49fc97c63fbdb93123855d91.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15254,37,'images/7c950471c7a87c622422c2039b11e279.webp','7c950471c7a87c622422c2039b11e279.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15255,37,'images/7ce1ed26a0f71037087ab88e412a6d46.webp','7ce1ed26a0f71037087ab88e412a6d46.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15256,37,'images/7ce2c5b208c7cf339bacb063b57f47c6.webp','7ce2c5b208c7cf339bacb063b57f47c6.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15257,37,'images/7d0248de1bf8f3bb2364c0df55bfbce5.webp','7d0248de1bf8f3bb2364c0df55bfbce5.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15258,37,'images/7d099b484f4e1e6473f0db443d086de2.webp','7d099b484f4e1e6473f0db443d086de2.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15259,37,'images/7d1f0b64acab4bd47fb59cb8afc2ea41.webp','7d1f0b64acab4bd47fb59cb8afc2ea41.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15260,37,'images/7d4a80ee15ef9b5e410f27f787f824f6.webp','7d4a80ee15ef9b5e410f27f787f824f6.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15261,37,'images/7d9ad1cb36cc955ab0f3e48cd5c82ea6.webp','7d9ad1cb36cc955ab0f3e48cd5c82ea6.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15262,37,'images/7d9e76d3b55d320d3d2e21b32f80d786.webp','7d9e76d3b55d320d3d2e21b32f80d786.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15263,37,'images/7da4d8c21f98639374c31431c7103823.webp','7da4d8c21f98639374c31431c7103823.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15264,37,'images/7dd2d564424b029da8680aaa16ab06fc.webp','7dd2d564424b029da8680aaa16ab06fc.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15265,37,'images/7e40aa94acc479305ad631258d56ed28.webp','7e40aa94acc479305ad631258d56ed28.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15266,37,'images/7e71d3128616a768876b73f6a75786c5.webp','7e71d3128616a768876b73f6a75786c5.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15267,37,'images/7e860d89e829d803d7d61b13b6c26e84.webp','7e860d89e829d803d7d61b13b6c26e84.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15268,37,'images/7e904a0d09bbd117220ce85182103f54.webp','7e904a0d09bbd117220ce85182103f54.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15269,37,'images/7ea52af611ba54cca6dab99304b8e676.webp','7ea52af611ba54cca6dab99304b8e676.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15270,37,'images/7ea616b39b79ecc29880b525923bbd04.webp','7ea616b39b79ecc29880b525923bbd04.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15271,37,'images/7eab159dedb29082e6563d9f93c1c3b1.webp','7eab159dedb29082e6563d9f93c1c3b1.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15272,37,'images/7ebbdbf731f92912f6b5ac71830dceeb.webp','7ebbdbf731f92912f6b5ac71830dceeb.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15273,37,'images/7ebd73678e91f2c9f26ff0022b83ce23.webp','7ebd73678e91f2c9f26ff0022b83ce23.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15274,37,'images/7ee1f266432e53f70deb83037c34d785.webp','7ee1f266432e53f70deb83037c34d785.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15275,37,'images/7ee67a4192535bf6a3fed4332b9a7b08.webp','7ee67a4192535bf6a3fed4332b9a7b08.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15276,37,'images/7ef795bc7a5dc8891c514ee18f0d4a13.webp','7ef795bc7a5dc8891c514ee18f0d4a13.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15277,37,'images/7f48b052bf592bfee31bd7b209d7e96c.webp','7f48b052bf592bfee31bd7b209d7e96c.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15278,37,'images/7f4925f71a28d7ab24dc99ecbe15f3ae.webp','7f4925f71a28d7ab24dc99ecbe15f3ae.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15279,37,'images/7f79867a57fbd8f9b8ba2c79951a5239.webp','7f79867a57fbd8f9b8ba2c79951a5239.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15280,37,'images/7f880521c9865b1f644482eec8e1da26.webp','7f880521c9865b1f644482eec8e1da26.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15281,37,'images/7facba03b23d879760350349698df195.webp','7facba03b23d879760350349698df195.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15282,37,'images/7fe84f5532c3357fdf3fcf1c038f81ac.webp','7fe84f5532c3357fdf3fcf1c038f81ac.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15283,37,'images/7feb88202b5d2122db1a5bb8a0b6dcad.webp','7feb88202b5d2122db1a5bb8a0b6dcad.webp','','','2025-10-12 22:45:06');
INSERT INTO zim_articles VALUES(15284,37,'images/8008342917ede1cdfb3c5e0e2f5248cf.webp','8008342917ede1cdfb3c5e0e2f5248cf.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15285,37,'images/80319d12a5795c4a2bf24b6bcc735058.webp','80319d12a5795c4a2bf24b6bcc735058.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15286,37,'images/8057582b64c01466ce779825ebdc8de7.webp','8057582b64c01466ce779825ebdc8de7.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15287,37,'images/8059658393aad5e2663b787480d36666.webp','8059658393aad5e2663b787480d36666.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15288,37,'images/8060be77a6f5f8a369d680b9d1bf8362.webp','8060be77a6f5f8a369d680b9d1bf8362.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15289,37,'images/808ce23dd5d28b1302bf673adcc11f2f.webp','808ce23dd5d28b1302bf673adcc11f2f.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15290,37,'images/8098b230d8c857c0299ddbeb3b05549f.webp','8098b230d8c857c0299ddbeb3b05549f.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15291,37,'images/80b756f45b70cf00f607ce74251a12b8.webp','80b756f45b70cf00f607ce74251a12b8.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15292,37,'images/80e0eede867acb5ddf831086b5691e9a.webp','80e0eede867acb5ddf831086b5691e9a.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15293,37,'images/80e4679b690c2a4a777a5a6ecf1467d1.webp','80e4679b690c2a4a777a5a6ecf1467d1.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15294,37,'images/80faa82bd99989d89f11345348ef9c1a.webp','80faa82bd99989d89f11345348ef9c1a.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15295,37,'images/8141883addecac2106d59e47150d5caa.webp','8141883addecac2106d59e47150d5caa.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15296,37,'images/8147e76facf2ca6ccad5218fe868e54d.webp','8147e76facf2ca6ccad5218fe868e54d.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15297,37,'images/814e5f0dd8d5f71f3dab3fdaaf0238e0.webp','814e5f0dd8d5f71f3dab3fdaaf0238e0.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15298,37,'images/8159e5f66b99fa78f7d2697a7acf1ffb.webp','8159e5f66b99fa78f7d2697a7acf1ffb.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15299,37,'images/8195f9f11ab09526bf543fdc98e39d88.webp','8195f9f11ab09526bf543fdc98e39d88.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15300,37,'images/819c38240396a018cf05e48715784e17.webp','819c38240396a018cf05e48715784e17.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15301,37,'images/81c20ea754e6d97e17143ac97b73ac65.webp','81c20ea754e6d97e17143ac97b73ac65.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15302,37,'images/81c98135a406f5b3ad06992150c244ff.webp','81c98135a406f5b3ad06992150c244ff.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15303,37,'images/8202bd837fda03486351d9f052576cf2.webp','8202bd837fda03486351d9f052576cf2.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15304,37,'images/82061c99d9b620f76eb44bb19fae83e5.webp','82061c99d9b620f76eb44bb19fae83e5.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15305,37,'images/8231d340a0da70f42407dbebb22e09fe.webp','8231d340a0da70f42407dbebb22e09fe.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15306,37,'images/824185b85c552ce57da9d0a3fcbefefa.webp','824185b85c552ce57da9d0a3fcbefefa.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15307,37,'images/826208ac68418f0969fd79e6f03f3264.webp','826208ac68418f0969fd79e6f03f3264.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15308,37,'images/8287a92ddfdfcd45e462b4ff74790077.webp','8287a92ddfdfcd45e462b4ff74790077.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15309,37,'images/829d76580fdae3c0d65da9844a28dca6.webp','829d76580fdae3c0d65da9844a28dca6.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15310,37,'images/82a8e0f16e00858ef70e7bceff73ccfd.webp','82a8e0f16e00858ef70e7bceff73ccfd.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15311,37,'images/82a993cc0a6739809671a2f9af419a35.webp','82a993cc0a6739809671a2f9af419a35.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15312,37,'images/82ba40a5c440c6c6da8671ff155ec51b.webp','82ba40a5c440c6c6da8671ff155ec51b.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15313,37,'images/82ebd0cd30b9637d116b06022e117d52.webp','82ebd0cd30b9637d116b06022e117d52.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15314,37,'images/82fba23ce258863f15e0944a86dfa8ba.webp','82fba23ce258863f15e0944a86dfa8ba.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15315,37,'images/8300cfeb5a95e6074a085abfbb6a9a60.webp','8300cfeb5a95e6074a085abfbb6a9a60.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15316,37,'images/8300e1c5adc441cc3550de290e130e44.webp','8300e1c5adc441cc3550de290e130e44.webp','','','2025-10-12 22:45:07');
INSERT INTO zim_articles VALUES(15317,37,'images/83195ed35085097