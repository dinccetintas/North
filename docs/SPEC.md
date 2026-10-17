# AI CEO OS: Ürün ve Build Spesifikasyonu

Oct 14, 2026 · @Dinc

## Özet

AI CEO OS (çalışma adı), kullanıcının CEO, AI ajanlarının ise çalışanı olduğu bir abonelik uygulamasıdır. Kullanıcı bir hedef ve bütçe verir ("Fikrim bu, $1000 bütçe, git yap"); ajan ekibi araştırmayı, ürünü, web sitesini, pazarlamayı, satışı ve operasyonu yürütür. Kullanıcıya sadece CEO'nun vermesi gereken kararlar gelir.

- **Kullanıcı:** tek başına kuran kişiler. Önce teknik bilgisi olan, tam zamanlı işi olan yapıcılar; sonra geliri olan solo operatörler.
- **Temel vaat:** iş değil sonuç. Ajanın yaptığı her eylem ölçülebilir bir metriğe bağlanır.
- **Proaktiflik:** sistem kullanıcı sormadan çalışır, fırsat getirir (örneğin Reddit'te konuşulan bir problem için "pazar araştırması yapayım mı?") ve sorunları kendisi çözer.
- **Dikkat bütçesi:** kullanıcıya günde en fazla 3 karar kartı gelir. Yüzlerce öneriye "evet" demek ürünün çözdüğü problemdir; ürün bunu tekrar üretmemeli.
- **Yapım ilkesi:** mümkün olan her yerde hazır araç kullanılır (kodlama için Claude Code, tasarım için Claude Design, ödeme için Stripe). Özgün kod sadece karar katmanı, şirket hafızası ve sonuç defteridir.

**Başarı ölçüsü (kuzey yıldızı):** haftalık, sonucu ölçülmüş ve kullanıcı tarafından onaylanmış karar sayısı (aktif şirket başına). Yan metrikler: 3. ay abonelik devamı, kullanıcı başı aylık çıkarım maliyeti / fiyat oranı, kullanıcı başı günlük karar kartı sayısı (hedef 3 ve altı).

## Temel kavramlar

Bu terimler kodda, veritabanında ve arayüzde aynı isimle kullanılmalı (kodda İngilizce adı geçerli).

| Kavram | Kod adı | Tanım |
| --- | --- | --- |
| Şirket | `Company` | Kullanıcının yürüttüğü girişim. Bir kullanıcının birden çok şirketi olabilir. |
| Tez | `Thesis` | Şirketin tek paragraflık fikri, hedef müşterisi ve neden şimdi. Tüm ajanların bağlamının kökü. |
| Hedef | `Goal` | Ölçülebilir hedef: metrik, hedef değer, tarih (ör. "30 günde 50 ödeme yapan kullanıcı"). |
| Bütçe | `Budget` | Kullanıcının ajanlara harcama yetkisi verdiği para; kalem kalem (reklam, alan adı, araç) ve günlük tavanlı. |
| Ajan | `Agent` | Bir role sahip AI çalışan (Araştırma, Yapım, Büyüme...). Araçları ve yetki seviyesi tanımlıdır. |
| Plan | `Plan` | Chief of Staff ajanının hedef için yazdığı haftalık iş planı: görevler ve beklenen metrik etkisi. |
| Görev | `Task` | Bir ajanın yapacağı tek iş; girdi, çıktı, durum, maliyet ve bağlı metrik taşır. |
| Eylem | `Action` | Dış dünyaya dokunan tek adım (e-posta gönder, reklam aç, deploy et). Her eylem risk katmanı alır ve denetim kaydına yazılır. |
| Karar Kartı | `DecisionCard` | Kullanıcıya gelen tek karar: bağlam, 2-3 seçenek, önerilen seçenek, varsayılan ve son tarih. |
| Sinyal | `Signal` | Proaktif katmanın yakaladığı dış veya iç olay (Reddit trendi, düşen metrik, hata, rakip hamlesi). |
| Sonuç Defteri | `OutcomeLedger` | Her görevin ve eylemin hangi metriği ne kadar oynattığının kaydı. |
| Şirket Hafızası | `Memory` | Tez, personalar, kararlar, üretilen dokümanlar ve öğrenimler; tüm ajanlar aynı hafızadan okur. |
| Brifing | `Brief` | Her sabah üretilen özet: dün ne oldu, metrikler, bekleyen kararlar, bugünün planı. |
| Artefakt | `Artifact` | Ajanların ürettiği kalıcı çıktı (PRD, iş planı, sunum, web sitesi, reklam görseli). |

## Ana döngü

Ürünün tamamı tek bir döngüdür: plan, eylem, sonuç, yeniden plan. Kullanıcı döngüye sadece iki yerden girer: hedef ve bütçe verirken ve karar kartına cevap verirken.

&#91;embedded content: ana döngü · plan, eylem, karar, sonuç\]

Chief of Staff hedefi plana böler, ajanlar görevleri yapar, yetki motoru her eylemin katmanını belirler. K0 ve K1 eylemler doğrudan çalışır; K2 ve K3 karar kartına düşer. Sonuç defteri her hafta planı yeniden yazdırır; sinyaller kullanıcı sormadan yeni iş açar. Sabah brifingi Chief of Staff'tan kullanıcıya gider.

## AI ekip

MVP sekiz rolle başlar. Her rol aynı şirket hafızasından okur, sadece kendi araçlarını kullanır ve işi Chief of Staff'tan alır. Roller birbirine doğrudan iş veremez; her devir Chief of Staff üzerinden geçer ve kayıt altına alınır.

| Rol | Sorumluluk | Araçlar | Ana çıktılar | Varsayılan en yüksek eylem katmanı |
| --- | --- | --- | --- | --- |
| Chief of Staff | Hedefi plana böler, görevleri dağıtır, sonucu ölçer, karar kartlarını ve sabah brifingini yazar | Hafıza, görev kuyruğu, sonuç defteri | Plan, Brifing, Karar Kartı | K1 |
| Araştırma | Pazar ve rakip araştırması, persona, trend ve fırsat taraması | Web arama, Reddit API, Product Hunt, Google Trends | Pazar raporu, persona, rakip haritası, Sinyal | K0 |
| Strateji ve Ürün | PRD, iş planı, fiyatlama, yatırımcı sunumu, yol haritası | Hafıza, doküman ve sunum üretimi | PRD, iş planı, yatırımcı sunumu, Mühendislik için görev listesi | K0 |
| Mühendislik | Web sitesi ve uygulamayı yapar, deploy eder, hataları düzeltir | Claude Code (Agent SDK), GitHub, Vercel, Supabase, Sentry | Repo, önizleme ve canlı deploy, düzeltme PR'ı | K2 (canlıya çıkma) |
| Tasarım | Marka kiti, arayüz, reklam ve sunum görselleri | Claude Design, görsel üretim (Higgsfield vb.) | Marka kiti, ekran tasarımları, reklam kreatifleri | K0 |
| Büyüme | Reklam, sosyal medya, SEO içeriği ve deneyler | Meta Ads API, Google Ads API, sosyal yayın API'leri | Kampanya, gönderi, deney sonucu | K2 (para harcama, kamuya yayın) |
| Satış | Potansiyel müşteri bulma, kişisel e-posta, pipeline takibi | Gmail, CRM (dahili tablo veya HubSpot), lead veri kaynağı | Lead listesi, e-posta dizisi, pipeline | K2 (ilk temas e-postası) |
| Operasyon ve Finans | Destek gelen kutusu, uptime, harcama ve gelir takibi | Destek e-postası, Sentry, Stripe | Destek yanıtları, olay raporu, haftalık finans özeti | K1 |

Yeni roller (Hukuk, İK, Yatırımcı İlişkileri) MVP sonrası aynı şablonla eklenir: rol tanımı + araç listesi + en yüksek eylem katmanı. Bu şablon kodda tek bir yapılandırma dosyası olmalı (ör. `agents/*.yaml`).

## Yetki ve bütçe modeli

Her eylem çalışmadan önce bir risk katmanı alır; katmanı ajan değil, kural motoru belirler. Ajan katmanı düşüremez, sadece yükseltebilir.

| Katman | Ne zaman | Davranış | Örnek |
| --- | --- | --- | --- |
| K0 Otomatik | Dış dünyaya dokunmaz veya tamamen geri alınabilir | Yapar, sadece kayıt | Araştırma, doküman, taslak, önizleme deploy'u |
| K1 Bildir | Dış dünyaya dokunur, geri alınabilir, bütçe harcamaz | Yapar, günlük brifingde görünür | Destek yanıtı (şablondan), hazır ve onaylı içerik takvimini yayınlama |
| K2 Karar kartı | Para harcar, kamuya yeni bir şey söyler, yeni bir kişiyle temas kurar veya canlıya çıkar | Karar kartı açar; kullanıcı son tarihe kadar cevap vermezse kartın tanımlı güvenli varsayılanı uygulanır | Reklam kampanyası başlatma, ilk satış e-postası, canlı deploy, fiyat değişikliği |
| K3 Sadece kullanıcı | Geri alınamaz ya da hukuki/finansal bağlayıcı | Kullanıcı açıkça onaylamadan asla çalışmaz, varsayılan yok | Sözleşme, ödeme hesabı değişikliği, veri silme, alan adı transferi, $500 üstü tek harcama |

**Karar kartı kuralları**

1. Günlük kota: kullanıcı başına varsayılan 3 kart (ayarlanabilir 1-5). Kota dolunca Chief of Staff kartları öncelik puanına göre sıralar, düşük olanları birleştirir veya ertesi güne bırakır.
2. Her kart: tek cümlelik karar sorusu, en fazla 3 seçenek, önerilen seçenek ve gerekçesi, beklenen metrik etkisi, maliyet, son tarih, güvenli varsayılan.
3. Kullanıcı aynı türde kararı 3 kez aynı yönde verirse sistem "bundan sonra bunu bana sorma" kuralı önerir (ör. "$50 altı reklam test bütçelerini otomatik onayla"). Kural ancak kullanıcı kabul ederse eklenir.

**Bütçe korumaları**

- Bütçe kalemlere bölünür (reklam, araç, alan adı, diğer); her kalemin toplam ve günlük tavanı vardır.
- Harcama her zaman kullanıcının kendi hesaplarından yapılır (kendi Meta Ads hesabı, kendi Stripe hesabı). Platform kullanıcının parasını tutmaz.
- Tavan aşılacaksa eylem durur ve K2 karar kartı açılır.
- Tek tıkla "tüm ajanları durdur" butonu her ekranda bulunur; aktif reklamları duraklatır, kuyruğu dondurur.

## Fonksiyonel gereksinimler

MVP, bir kullanıcının tek bir fikirle başlayıp 30 gün boyunca sadece karar kartlarına cevap vererek canlı bir ürün, çalışan bir edinim kanalı ve ölçülmüş sonuç elde etmesidir. Her gereksinim ID'si commit ve testlerde referans verilir.

| ID | Gereksinim | Kabul kriteri | Faz |
| --- | --- | --- | --- |
| ONB-1 | Kullanıcı fikrini serbest metinle yazar; sistem en fazla 5 netleştirme sorusu sorar | 10 dakikada Tez, ilk Hedef ve Bütçe kaydedilmiş olur | MVP |
| ONB-2 | Kullanıcı hedef metriği, hedef değeri, tarihi ve bütçeyi belirler | Bütçe kalemleri ve günlük tavanlar kaydedilir | MVP |
| ONB-3 | Kullanıcı araçlarını OAuth ile bağlar (Gmail, GitHub, Vercel, Stripe, Meta Ads) | Bağlanmayan araç gerektiren görev, "bağla" karar kartına dönüşür; sistem çökmez | MVP |
| PLN-1 | Chief of Staff hedeften haftalık plan üretir | Her görevde sahip ajan, beklenen metrik etkisi ve maliyet tahmini var | MVP |
| PLN-2 | Plan her hafta sonuç defterine göre yeniden yazılır | Çalışmayan görev tipleri bir sonraki planda azalır ve gerekçesi yazılır | MVP |
| AGT-1 | Her ajan görevini kendi araçlarıyla, ayrı bir sandbox'ta çalıştırır | Görev durumu: queued, running, waiting\_decision, done, failed | MVP |
| AGT-2 | "Bitti" sadece doğrulanabilir kanıtla işaretlenir (URL, deploy ID, gönderilen e-posta ID'si, test sonucu) | Kanıtsız görev done olamaz | MVP |
| AGT-3 | Başarısız görev en fazla 2 kez farklı yaklaşımla denenir, sonra Chief of Staff'a döner | Sonsuz döngü ve kredi yakma olmaz | MVP |
| DEC-1 | K2 ve K3 eylemler karar kartı üretir (Yetki modeli bölümü) | Kartsız K2/K3 eylem çalışmaz; test ile doğrulanır | MVP |
| DEC-2 | Kartlar web ve mobilde tek dokunuşla cevaplanır; push bildirim ve e-posta ile gelir | Cevap 2 saniyede ajan kuyruğuna yansır | MVP |
| DEC-3 | Günlük kart kotası ve otomatik onay kuralı önerisi | Kota hiçbir gün aşılmaz | MVP |
| BRF-1 | Her sabah kullanıcının saat dilimine göre brifing | Brifing 60 saniyede okunur: dün, metrikler, bekleyen kararlar, bugün | MVP |
| OUT-1 | Her görev ve eylem bir metriğe bağlanır; metrik değişimi kaydedilir | Sonuç defterinde "ne yaptık, ne değişti, ne kadar tuttu" görünür | MVP |
| OUT-2 | Metrik kaynakları: Stripe, web analitiği (Vercel/PostHog), reklam API'leri, e-posta yanıtları | Metrikler en az günde bir güncellenir | MVP |
| MEM-1 | Tüm çıktılar şirket hafızasına yazılır ve aranabilir | Bir ajan başka bir ajanın çıktısını kullanıcı kopyalamadan kullanır | MVP |
| MEM-2 | Artefaktlar (PRD, iş planı, yatırımcı sunumu) sürümlü saklanır ve indirilebilir (MD, PDF, PPTX) | Her artefaktın sürüm geçmişi var | MVP |
| PRO-1 | Araştırma ajanı tanımlı kaynakları periyodik tarar ve Sinyal üretir | Sinyal, eşik aşılınca karar kartına dönüşür; sohbet açmaz | MVP |
| PRO-2 | Operasyon ajanı hata ve kesintileri yakalar, Mühendislik'e düzeltme görevi açar | Sentry hatasından düzeltme PR'ına kadar insan müdahalesi gerekmez (canlıya çıkma K2) | MVP |
| PRO-3 | Yeni fikir önerisi: haftada en fazla 1 "yeni fırsat" kartı | Kart kanıt linkleri içerir | V2 |
| CHAT-1 | Kullanıcı istediğinde Chief of Staff ile sohbet edebilir; sohbet asla zorunlu değildir | Sohbetten çıkan karar hafızaya yazılır | MVP |
| MULTI-1 | Kullanıcı birden çok şirket yönetir; brifing hepsini tek ekranda toplar | Şirketler arası hafıza sızıntısı olmaz | V2 |
| BIL-1 | Stripe ile abonelik: Solo $99/ay (1 şirket), Pro $299/ay (3 şirket), Scale $999/ay (10 şirket); fiyatlar yapılandırmadan değiştirilebilir | Abonelik bitince ajanlar durur, veri 90 gün saklanır, dışa aktarılabilir | MVP |
| BIL-2 | Her plan aylık iş kredisi içerir; kredi bitince ek kredi satın alınır | Kullanıcı başı maliyet panelde görünür | MVP |
| EXP-1 | Kullanıcı kodunu (GitHub repo kendi hesabında), verisini ve artefaktlarını her an alıp gidebilir | Repo baştan kullanıcının GitHub hesabında oluşturulur | MVP |

## Ekranlar

Uygulama bir sohbet arayüzü değil, bir yönetim kurulu odasıdır: açılış ekranı karar kartları ve brifingdir. Mobil öncelikli tasarlanır; kullanıcı günde 5 dakika ile yönetebilmeli.

| Ekran | Amaç | İçerik | Ana eylem |
| --- | --- | --- | --- |
| Sabah (ana ekran) | Bugün ne karar vermem gerekiyor? | Brifing, bekleyen karar kartları (en fazla 3), hedefe ilerleme çubuğu | Kararı ver |
| Karar kartı detayı | Kararı bilgiyle vermek | Soru, seçenekler, öneri, kanıt linkleri, maliyet, son tarih | Seç, değiştir, "bunu bir daha sorma" |
| Şirket paneli | Şirketin durumu | Hedef ve metrikler, bütçe harcaması, haftalık plan, sonuç defteri | Hedef/bütçe değiştir |
| Ekip | Ajanlar ne yapıyor? | Rol kartları, aktif görevler, son 24 saatin eylem akışı | Görevi durdur, "tüm ajanları durdur" |
| Sonuç defteri | Ne işe yaradı? | Eylem, metrik, değişim, maliyet tablosu; çalışan ve çalışmayan kanallar | Dışa aktar |
| Artefaktlar | Üretilen her şey | PRD, iş planı, sunum, web sitesi linkleri, görseller; sürümlü | İndir, paylaş |
| Chief of Staff | İsteğe bağlı sohbet | Hafızaya bağlı sohbet; "yeni hedef", "bu fikri araştır" gibi komutlar | Yeni hedef ver |
| Bağlantılar | Araçları bağlamak | OAuth durumu, izin kapsamları | Bağla, bağlantıyı kes |
| Ayarlar ve faturalama | Plan ve kurallar | Abonelik, kredi kullanımı, karar kotası, otomatik onay kuralları | Kuralı sil veya düzenle |

Onboarding tek akıştır: fikir metni, netleştirme soruları, hedef ve bütçe, araç bağlama, ilk planın özeti ve onayı. Onayın ardından ilk 24 saat içinde kullanıcıya en az bir somut çıktı gelir (pazar raporu ve yayında bir landing page önizlemesi).

## Mimari ve teknoloji

Yazılacak özgün kod üç bileşendir: karar katmanı, şirket hafızası ve sonuç defteri. Ajanların yetenekleri hazır servislerden gelir.

&#91;embedded content: mimari · 3 özgün bileşen, 5 ajan grubu\]

Uygulama karar kartlarını ve brifingi gösterir; orkestratör görevleri ajanlara dağıtır; dış dünyadan gelen metrikler sonuç defterine geri akar.

| Katman | Seçim | Neden |
| --- | --- | --- |
| Arayüz | Next.js (App Router), Tailwind, shadcn/ui, PWA; Vercel'de host | Hızlı, mobil kurulabilir, Mühendislik ajanı da aynı yığını kullanır |
| Kimlik, veri, dosya | Supabase: Auth, Postgres, RLS, pgvector, Storage, Vault | Tek servis, şirket bazlı izolasyon |
| İş kuyruğu | Inngest (zamanlanmış ve kaldığı yerden devam eden işler) | Uzun ajan görevleri, sabah brifingi, periyodik tarama |
| Ajan çalışma zamanı | Claude Agent SDK; uzun görevlerde Claude Managed Agents veya izole sandbox (E2B, Vercel Sandbox) | Araç kullanımı ve sandbox hazır |
| Kod üretimi | Claude Code (headless), kullanıcının GitHub reposunda, GitHub App ile | Kod kullanıcıda kalır (EXP-1) |
| Tasarım | Claude Design + görsel üretim API'si | Marka kiti, ekran ve reklam görselleri |
| Abonelik | Stripe Billing | Planlar ve kredi satışı |
| Kullanıcı metrikleri | Kullanıcının Stripe'ı (OAuth, okuma), PostHog veya Vercel Analytics, reklam API'leri | Sonuç defterinin veri kaynağı |
| Bildirim | Web push + e-posta (Resend) | Karar kartları ve brifing |
| Gözlem | Langfuse (LLM trace ve maliyet), Sentry | Görev bazlı maliyet ve hata |
| Dış entegrasyonlar | Gmail API, GitHub App, Vercel API, Meta Marketing API, Google Ads API, Reddit API (okuma) | MVP kapsamı |

## Veri modeli

Tek Postgres veritabanı (Supabase), her tabloda `company_id` ve row-level security. `actions` ve `ledger_entries` sadece eklenir, güncellenmez ve silinmez; bunlar denetim kaydıdır.

| Tablo | Ana alanlar | Not |
| --- | --- | --- |
| `users` | id, email, timezone, daily\_decision\_quota, plan | Supabase Auth |
| `companies` | id, owner\_id, name, status (active, paused, archived) | Bir kullanıcı çok şirket |
| `theses` | company\_id, version, text, target\_customer, why\_now | Sürümlü |
| `goals` | id, company\_id, metric\_key, target\_value, due\_date, status | Bir şirkette aynı anda en fazla 3 aktif hedef |
| `budgets` | company\_id, category, total\_limit, daily\_limit, spent, currency | Kalem bazlı |
| `agents` | id, company\_id, role, config\_ref, max\_action\_tier, enabled | Rol tanımı `agents/*.yaml`'dan |
| `plans` | id, company\_id, goal\_id, week\_start, summary, rationale | Haftalık |
| `tasks` | id, plan\_id, agent\_id, title, input, status, evidence\_url, cost\_usd, metric\_key, expected\_delta, attempts | AGT-1/2/3 |
| `actions` | id, task\_id, type, tier, payload, status, external\_ref, created\_at | Sadece ekleme; her dış eylem |
| `decision_cards` | id, company\_id, action\_id, question, options (json), recommended, default\_option, due\_at, answered\_option, answered\_at | DEC-1/2/3 |
| `auto_rules` | id, company\_id, condition (json), created\_from\_card\_id, active | "Bunu bir daha sorma" kuralları |
| `signals` | id, company\_id, source, summary, evidence\_urls, score, converted\_card\_id | PRO-1 |
| `metrics` | company\_id, metric\_key, value, source, measured\_at | Zaman serisi |
| `ledger_entries` | id, company\_id, task\_id, metric\_key, before, after, cost\_usd, attribution\_note | OUT-1; sadece ekleme |
| `memory_items` | id, company\_id, kind (thesis, persona, decision, learning, doc), content, embedding (pgvector) | MEM-1 |
| `artifacts` | id, company\_id, kind, title, version, storage\_path, created\_by\_agent | MEM-2 |
| `briefs` | id, company\_id, date, content | BRF-1 |
| `connections` | id, user\_id, provider, scopes, encrypted\_token, status | Tokenlar Supabase Vault veya KMS ile şifreli |
| `usage` | user\_id, period, credits\_used, llm\_cost\_usd, sandbox\_minutes | BIL-2 |

## Fonksiyonel olmayan gereksinimler

Bu üründe güven bir özellik değil, ürünün kendisidir: kullanıcı ajanın ne yaptığını her an görebilmeli, durdurabilmeli ve verisini alıp gidebilmeli.

| Alan | Gereksinim |
| --- | --- |
| Denetim | Her dış eylem `actions` tablosuna; kim, ne, ne zaman, hangi katman, hangi kart onayladı bilgisiyle yazılır. Silinemez. |
| Güvenlik | OAuth tokenları şifreli saklanır, en dar kapsam istenir. Ajan sandbox'ları kullanıcılar arasında izole. Ajan çıktısındaki talimatlar (web sayfası, e-posta içeriği) komut olarak değil veri olarak işlenir (prompt injection koruması). |
| Kill switch | "Tüm ajanları durdur" 5 saniyede tüm kuyruğu durdurur ve aktif reklamları duraklatır. |
| Maliyet | Kullanıcı başı aylık çıkarım + sandbox maliyeti plan fiyatının %40'ını geçmeyecek şekilde görev başına token tavanı ve model yönlendirmesi (basit işe küçük model). Maliyet görev bazlı kaydedilir. |
| Gözlem | Her ajan çalışması izlenir (trace: prompt, araç çağrıları, süre, maliyet). Hata oranı, görev tamamlama oranı, kanıtsız "done" girişimi metrik olarak izlenir. |
| Güvenilirlik | Uzun görevler kaldığı yerden devam edebilir (durable workflow). Bir dış API hatası tüm planı durdurmaz. |
| Platform kuralları | Reklam, e-posta ve sosyal medya eylemleri platform politikalarına uyar: spam yok, sahte hesap yok, kullanıcı adına sahte yorum yok. Reddit'te gönderi atmak MVP'de yok; Reddit sadece okunur. |
| Gizlilik | Kullanıcı verisi model eğitimi için kullanılmaz. Şirketler arası hafıza izolasyonu testle doğrulanır. |
| Performans | Ana ekran 1.5 saniyede yüklenir; karar cevabı 2 saniyede kuyruğa yansır. |

## Faz 2 gereksinimleri

Faz 2 (stüdyo fazı, M7 ve sonrası) gereksinimleri `docs/superpowers/specs/2026-10-16-north-studio-phase-design.md` bölüm 12'den gelir; Faz 1 ID'leri gibi bu ID'ler de commit mesajlarında ve test adlarında kullanılır. Kilometre taşı sütunu tasarım dokümanındaki değerin aynısıdır.

| ID | Gereksinim | Kilometre taşı |
| --- | --- | --- |
| SEC-1 | Ajanların kabuk komutları sandbox içinde çalışır; hiçbir ajan süreci model anahtarını tutmaz | M7 |
| SEC-2 | Şirketler arasında hiçbir ajan yapılandırması, hafıza veya oturum paylaşılmaz | M7 |
| CMP-1 | Her ilk temas e-postası alt bilgiyi, posta adresini ve List-Unsubscribe başlığını taşır; gönderim engellerine (suppression) `gate()` uyar | M7 |
| CMP-2 | E-posta yalnızca kural seti kodlanmış ve test edilmiş bölgelere gider; yalnızca izinle gönderime açık yargı bölgelerinde kayıtlı izin gerekir | M12 |
| TST-1 | Model profilleri ve test bütçe koruması; production kontrolü production dışındaki profilleri reddeder | M7 |
| TST-2 | Her PR'da, kendi tavanı içinde, gerçek Claude ile smoke testi | M7 |
| TST-3 | Staging'de her gece gerçek kullanıcı yolculuğu | M7 |
| TST-4 | Kurucu onayı ve commit edilmiş kanıtla kilometre taşı canlı kabul testi | M7 |
| TST-5 | `gate()` içinde test hesabı çiti | M7 |
| STG-1 | Kurucunun giriş yaptığı bir staging ortamı | M7 |
| SKL-1 | Repoya alınmış (vendored) skill'ler; kilit dosyası, lisans ve hash kontrolleri `pnpm validate` içinde | M8 |
| SKL-2 | Her persona yalnızca kendi skill'lerini bağlar; yüklenen ve çağrılan skill'ler görünürdür | M8 |
| TEAM-1 | Onboarding'de, denetlenmiş katalogdan ekip önerisi | M8 |
| TEAM-2 | Departman başına inceleme ayarı (review dial) | M8 |
| LOOP-1 | Taslak, ayrı bir eleştirmen, revizyon; kesin kapıları (hard gate) kod belirler; en fazla 2 revizyon | M8 |
| LOOP-2 | Fork ile 2-3 varyant, kurucu seçmeden önce sıralanır | M8 |
| REV-1 | Karar kotasından ayrı, kendi bütçesi ve 24 saatlik varsayılanı olan inceleme kuyruğu | M8 |
| REV-2 | Metne sabitlenmiş yorumlar, diff'i ve geri alması olan tek bir revizyon üretir | M8 |
| LIVE-1 | Sadece eklenen çalışma olaylarından (run events) beslenen canlı iş görünümü | M8 |
| CHAT-2 | Herhangi bir personayla birebir sohbet; "Bağlama ekle" hafızaya kaynağıyla (provenance) birlikte yazar | M8 |
| VAL-1 | Doğrulama öncelikli onboarding görevleri | M8 |
| VAL-2 | Bir sonraki K2 kartında kapı bağlamı (gate context) | M10 |
| VAL-3 | Görüşme kanıtı yalnızca gerçek kaynaklardan gelir | M10 |
| DSN-1 | Doğrulanmış dosyalar olarak marka kiti | M9 |
| DSN-2 | Ekran görüntüleriyle 2-3 site yönü | M9 |
| DSN-3 | Poster yedeği ve performans kapılarıyla 3D ve hareket | M9 |
| WEB-1 | Kullanıcının reposunda, Vercel'inde ve Supabase'inde landing page ve bekleme listesi; worker'ın çalıştırdığı kapılarla doğrulanır | M9 |
| MCP-1 | Sağlayıcı MCP sunucuları ajanlara yalnızca okuma araçları açar; yazma işlemleri worker'da `gate()` sonrasında çalışır | M11 |
| MKT-1 | Meta kampanyaları önce duraklatılmış (paused) açan kreatif hattı | M11 |
| MKT-2 | Üretilen her varlıkta yapay zekâ beyan işaretleri | M11 |
| MKT-3 | Kanal katmanları: taslaklar ve özel yüklemeler K1, yeni herkese açık gönderiler K2 | M11 |
| MKT-4 | vidIQ ile YouTube araştırması | M11 |
| MKT-5 | Pull request olarak SEO brifleri ve sayfaları | M11 |
| SLS-1 | Kullanıcının anahtarlarıyla, North araçlarının arkasında lisanslı lead sağlayıcıları | M12 |
| SLS-2 | Doğrulama ve teslim edilebilirlik koruması | M12 |
| SLS-3 | Parti başına onaylanan e-posta dizileri; takip e-postaları K1'dir ve otomatik iptal edilir | M12 |
| SLS-4 | Pipeline olayları ve Cal.com randevuları | M12 |
| LRN-1 | Her ders en az bir doğrulanmış kanıt referansı ve kodla hesaplanmış bir güven değeri taşır; kanıt yoksa ders yok | M8 |
| LRN-2 | Dersler RLS altında bir şirkete veya bir departmana kapsamlanır; playbook akışı dışında hiçbir şey şirketler arasında geçmez | M8 |
| LRN-3 | Eleştirmen persona (taze bağlam, salt okunur araçlar) her hafta bir departman retrosu yapar ve ders önerir; davranış değiştiren türler inceleme kuyruğundan geçer | M8 Design; M10-M12 the others |
| LRN-4 | Her çalışma aldığı dersleri kaydeder; sonuçlar ders başına geri atfedilir | M8 |
| LRN-5 | Derslerin süresi dolar, yerlerine yenisi geçer veya otomatik olarak emekliye ayrılırlar; emekli dersler kaynağıyla okunabilir kalır; geri alma vardır | M8 |
| LRN-6 | Hafıza bir çalışmaya sınırlı bir blok içinde veri olarak girer; çıkarıcılar transkriptleri, araç sonuçlarını ve alıntılanan içeriği güvenilmez sayar | M7 |
| LRN-7 | Gömmeleri Supabase içinde üretilen hibrit tam metin ve vektör araması; departmana ve görev türüne göre tipli erişim | M7 pipeline, M8 contract |
| LRN-8 | Hafıza ekranı dersleri, kaynaklarını, uygulamalarını ve sonuçlarını gösterir; geri alma ve yerine yenisini koyarak düzenleme vardır | M8 basic, M9 full |
| LRN-9 | Derslerden türetilen persona brif satırları ve rubrik ağırlığı değişiklikleri önerilir, sürümlenir ve kurucu tarafından onaylanır | M9 |
| LRN-10 | Her gece derslerle ve derssiz değerlendirmeler farkı, isabet oranını ve zarar oranını raporlar; bir gerileme dersi emekliye ayırır | M8 |
| LRN-11 | Şirketler arası playbook'lar isteğe bağlıdır, en az üç şirketten toplanır, temizlenir, etkinleşmeden önce North tarafından incelenir ve ajanlar için salt okunurdur | M10 design, M11 entries |
| LRN-12 | Satış kaynaklı kanıtı (lead sağlayıcıları, erişim, yanıtlar, pipeline) olan hiçbir ders şirketler arasında yükseltilmez | M12 |

## Build planı

Yedi kilometre taşı, sırayla. Bir sonraki taşa ancak öncekinin kabul kriteri geçince geçilir. M2 (karar katmanı), dış dünyaya dokunan herhangi bir ajandan (M3, M4) önce bitmelidir.

1. **M0 İskelet.** Next.js + Supabase (Auth, Postgres, RLS) + Stripe test modu + `agents/*.yaml` yükleyici + durable iş kuyruğu.
   - Kabul: kullanıcı kayıt olur, şirket oluşturur; RLS testleri bir kullanıcının başka şirketi göremediğini kanıtlar.
2. **M1 Çekirdek döngü.** Onboarding (ONB-1/2), Chief of Staff planı (PLN-1), Araştırma ve Strateji ajanları (sadece K0), şirket hafızası ve artefaktlar (MEM-1/2).
   - Kabul: fikir metninden 24 saat içinde pazar raporu, personalar, PRD, iş planı ve yatırımcı sunumu taslak artefakt olarak hazır.
3. **M2 Karar katmanı.** Katman motoru, karar kartları, günlük kota, otomatik onay kuralları, push/e-posta, kill switch, denetim kaydı (DEC-1/2/3).
   - Kabul: test paketi, kartsız hiçbir K2/K3 eylemin çalışmadığını ve kotanın aşılmadığını kanıtlar.
4. **M3 Yapım ve tasarım.** Mühendislik ajanı (Claude Agent SDK, sandbox), kullanıcının GitHub hesabında repo, Vercel önizleme ve canlı deploy (K2), Tasarım ajanı, AGT-1/2/3.
   - Kabul: PRD'den yayında bir landing page; canlıya çıkma kart onayıyla oldu, kanıt olarak deploy URL'i kaydedildi.
5. **M4 Büyüme, satış ve sonuç defteri.** Meta Ads ve Google Ads, Gmail ile kişisel e-posta, metrik toplayıcılar (OUT-2), sonuç defteri (OUT-1), bütçe korumaları.
   - Kabul: bir test kampanyası uçtan uca çalışır; harcama, tıklama ve kayıt sonuç defterinde görünür; tavan aşılmaz.
6. **M5 Proaktif katman.** Sabah brifingi (BRF-1), Sinyal taraması (PRO-1), Sentry'den düzeltme PR'ına (PRO-2), haftalık plan revizyonu (PLN-2).
   - Kabul: kullanıcı 7 gün boyunca hiç sohbet açmadan sadece kartlara cevap vererek şirketi yürütür.
7. **M6 Abonelik ve lansman.** Planlar ve krediler (BIL-1/2), kullanım paneli, dışa aktarma (EXP-1), mobil PWA.
   - Kabul: ilk şirket olarak kurucunun kendi fikri (GCC'de Function Health benzeri uygulama) platformda 30 gün çalışır; ödeme yapan ilk 10 kullanıcı.

## Build agent'ı için talimatlar

Bu dokümanı alan ajan önce plan yazar, sonra kod. Belirsiz bir nokta varsa tahmin etmez; açık kararlar listesine ekler ve varsayımla devam eder.

1. Başlamadan önce bu dokümanı `docs/SPEC.md` olarak repoya koy; her kilometre taşı için `docs/plans/M<n>.md` planı yaz.
2. Kilometre taşlarını sırayla yap. Her taşın sonunda kabul kriterini çalışan bir test veya demo kaydıyla kanıtla.
3. Gereksinim ID'lerini (ör. DEC-1) commit mesajlarında ve test adlarında kullan.
4. Yetki modeli (K0-K3) kodda tek bir modüldedir ve her dış eylem ondan geçer. Bu modülü atlayan bir eylem yolu hata sayılır.
5. Hazır araç varken yazma: kimlik, ödeme, kuyruk, sandbox, analitik için yönetilen servis kullan. Özgün kod: karar katmanı, şirket hafızası, sonuç defteri, ajan rol yapılandırması.
6. Gerçek para harcayan veya gerçek kişilere ulaşan entegrasyonları (reklam, e-posta) önce test/sandbox hesaplarıyla geliştir; canlı anahtarlar sadece kurucu tarafından girilir.
7. Her kilometre taşı sonunda kısa bir rapor yaz: ne yapıldı, kabul kanıtı, açık kalanlar, kullanıcı başı tahmini maliyet.

**Kapsam dışı (MVP)**

- 10+ kişilik ekipler, rol bazlı yetkiler, SSO.
- Platformun kullanıcı adına para tutması veya ödeme alması (her ödeme kullanıcının kendi Stripe hesabından).
- Reddit, X veya forumlarda kullanıcı adına gönderi ve yorum.
- Hukuki sözleşme imzalama, şirket kuruluşu, vergi beyanı.
- Kendi LLM'imizi eğitmek.
- Yerel masaüstü uygulaması (MVP web + mobil PWA).

**Açık kararlar (kurucu verecek)**

| Karar | Varsayılan (karar gelene kadar) |
| --- | --- |
| Ürün adı ve alan adı | "AI CEO OS" çalışma adı |
| İlk pazar ve dil: global (İngilizce) mi, GCC (İngilizce + Arapça) mı? | Global, İngilizce arayüz |
| Fiyatlar ve kredi miktarları | BIL-1'deki rakamlar, yapılandırılabilir |
| Durable kuyruk servisi | Inngest |
| Varsayılan model yönlendirmesi | Planlama ve kod için Claude Opus/Sonnet, özet ve sınıflandırma için Haiku |
| Lead veri kaynağı (Satış ajanı) | MVP'de kullanıcının yüklediği liste + web araştırması |
| Reklam ve e-posta için yasal sorumluluk metni ve kullanım şartları | Lansmandan önce avukat incelemesi |
