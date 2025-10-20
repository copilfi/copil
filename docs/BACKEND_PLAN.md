# Backend Teslim Planı (Güvenli, Hızlı ve Üretime Hazır)

Durum: aktif geliştirme. Her fazda işaretlenebilir kutular mevcut; ilerledikçe güncellenecek.

İlerleme: 11/11 faz tamamlandı.

## Faz Listesi (Onay Kutuları)
- [x] Faz 0 — Taban Sağlamlaştırma
- [x] Faz 1 — Auth ve API Güvenliği
- [x] Faz 2 — Transaction Pipeline Dayanıklılık
- [x] Faz 3 — Quotes/Providers Doğruluk + Performans
- [x] Faz 4 — Sei Bridge (Axelar) Tamamlama
- [x] Faz 5 — Session Key Policy Geliştirme
- [x] Faz 6 — Portfolio ve Metadata Performans
- [x] Faz 7 — Strategy Evaluator ve Otomasyon Sağlamlığı
 - [x] Faz 8 — Observability, Loglama, Sağlık
- [x] Faz 9 — Performans ve Kaynak Kullanımı
- [x] Faz 10 — API Sabitleme ve Dokümantasyon

---

## Faz 0 — Taban Sağlamlaştırma
- Hedefler:
  - Bağımlılıkların ve Node sürümünün sabitlenmesi (lockfile, versiyon pinleme)
  - Ortam değişkenlerinin merkezi doğrulanması; eksikte fail‑fast
  - Graceful shutdown; `unhandledRejection/uncaughtException` handler’ları
- Kabul Kriterleri:
  - Yanlış/eksik env ile deterministik ve açık hata mesajı
  - Doğru env ile tüm servisler stabil başlar ve düzgün kapanır

## Faz 1 — Auth ve API Güvenliği
- Hedefler:
  - JWT/Privy doğrulamasında JWKS cache/rotate; `iss|aud|nbf|exp` katı denetimi
  - CORS allowlist (çoklu origin, env ile); uygunsuz origin red
  - Rate limit ince ayarı (global ve endpoint bazlı throttle)
  - DTO/girdi validasyonu: adres/hex regex, BigInt taşma koruması
- Kabul Kriterleri:
  - Geçersiz tokenlar/expired/nbf reddedilir; CORS ve rate‑limit kayıt altına alınır
  - Tüm giriş noktaları şemalı doğrulama ile 400 döner (yanlış payload)

## Faz 2 — Transaction Pipeline Dayanıklılık
- Hedefler:
  - Idempotency: `/transaction/execute` için `idempotencyKey`; aynı kullanıcı/anahtar için tek job
  - Concurrency: kullanıcı başına eşzamanlı job limiti; backpressure
  - Timeout/Retry: quote/signer için makul timeout ve sınırlı retry (jitter)
  - TransactionLog alanları: `jobId`, `idempotencyKey`, zengin `details`
- Şema/Migration:
  - `TransactionLog` tablosuna `idempotencyKey text NULL`, `jobId text NULL`, index( userId, createdAt ), unique (userId, idempotencyKey )
  - (Opsiyonel) `Idempotency` tablosu: user_id, key, response_hash, created_at (unique (user_id, key))
- Kabul Kriterleri:
  - Aynı istek tekrarlandığında duplikasyon yok; tek job id’si dönüyor
  - Yoğunlukta belirlenen limit aşıldığında kontrollü hata (429/409) ve log

## Faz 3 — Quotes/Providers Doğruluk + Performans
- Hedefler:
  - OneBalance mapping/normalizasyon: `symbol/address/decimals`, `slippageBps` doğru iletilir
  - Non‑custodial guard güçlendirme: `transactionRequest` varyantlarının tamamında katı kontrol
  - Li.Fi comparator: yalnızca `transactionRequest` üreten rotalar „executable“ kabul
  - Quote sonuçları için kısa süreli cache (kullanıcı+intent hash; 15–30 sn)
- Kabul Kriterleri:
  - Custodial/deposit gerektiren akışlar reddedilir; hata mesajı açıklayıcıdır
  - `quote/providers` P95 < 1.5s; tekrarlı çağrılar cache’den gelir

## Faz 4 — Sei Bridge (Axelar) Tamamlama
- Hedefler:
  - `AxelarBridgeClient` içinde `destinationAddress` zorunlu kullanım; onboarding ile tam hizalama
  - Env doğrulama: `SEI_BRIDGE_ENABLED`, `AXELAR_GATEWAY_ADDRESS_<CHAIN>`; yanlış konfig’de fail‑fast
  - Approve + `sendToken` sırasının açık belirtilmesi ve her iki tx’in de executable olması
  - `/transaction/bridge/config` çıktısının detaylandırılması (hazır zincirler, eksik env)
- Kabul Kriterleri:
  - EVM→Sei köprüsü non‑custodial 2‑adım (approve→sendToken) `transactionRequest` seti üretir
  - Hedef adres Smart Account (Safe) ile eşleşir (onboarding plan/quote ile tutarlı)

## Faz 5 — Session Key Policy Geliştirme
- Hedefler:
  - Pencere bazlı harcama limiti: N saniyede X tutar (basit sayaç ve zaman penceresi)
  - `allowedContracts` kontrolü: approval ve ana tx dahil tüm adımlara uygulanır
  - Kullanım telemetrisi: `TransactionLog.details` ve SessionKey metadata güncellenir
- Şema/Migration:
  - `SessionKey` tablosuna `lastUsedAt timestamptz NULL`, `usageCount int DEFAULT 0`
- Kabul Kriterleri:
  - Limit aşımı deterministik ve açıklayıcı şekilde reddedilir
  - İzinli adres dışı hedeflerde yürütme gerçekleşmez

## Faz 6 — Portfolio ve Metadata Performans
- Hedefler:
  - OneBalance aggregated balance için kısa TTL cache (kullanıcı bazlı)
  - TokenMetadata ile sembol/decimal enrich; eksiklerde best‑effort doldurma
- Kabul Kriterleri:
  - `/portfolio` cache açıkken P95 < 300ms; sembol/decimal tutarlı

## Faz 7 — Strategy Evaluator ve Otomasyon Sağlamlığı
- Hedefler:
  - Evaluator’da retry/backoff; aynı strateji için aynı anda tek aktif job (jobId pattern)
  - Trigger durumu: `lastTriggeredAt`; tek seferlikte otomatik de‑aktivasyon sağlamlaştırma
  - İç servis çağrılarında service‑token/allowlist (evaluator ↔ API)
- Kabul Kriterleri:
  - Çifte tetikleme yok; başarısızlıklar retry ile toparlanır; yetkisiz dahili çağrı yok

## Faz 8 — Observability, Loglama, Sağlık
- Hedefler:
  - Yapılandırılmış JSON log; requestId/korelasyon; hassas veri maskeleme
  - Health endpoint’lerinin zenginleştirilmesi: DB/Redis check, kuyruk metrikleri
  - Basit metrikler: quote latency, exec başarı oranı, queue derinliği (Prometheus’a uygun)
- Kabul Kriterleri:
  - Operasyonel sorunlar log/metrics üzerinden görünür; health gerçek durumu yansıtır

## Faz 9 — Performans ve Kaynak Kullanımı
- Hedefler:
  - HTTP client (axios/undici) timeouts, keep‑alive, connection pool ayarları
  - Queue concurrency ve RPC rate‑limit ayarları; backoff stratejileri
- Kabul Kriterleri:
  - Quote/execute boru hattında gereksiz bekleme yok; P95 değerler hedefte

## Faz 10 — API Sabitleme ve Dokümantasyon
- Hedefler:
  - Endpoint sözleşmelerinin sonlandırılması; hata mesajları/status kodları uyumu
  - Env matrisi ve minimum gerekli setin net dokümantasyonu
  - Akış dökümanı: onboarding/fund, quote/providers, execute, logs
- Kabul Kriterleri:
  - Dokümantasyon ile uygulama davranışı tutarlı; entegrasyon yapanların ek soruya ihtiyaç duymaması

---

### Notlar ve İlk İcra Sırası
1) Faz 1 (Auth/Güvenlik) + Faz 2 (Idempotency/Concurrency)
2) Faz 3 (Quotes doğruluğu)
3) Faz 4 (Sei Bridge hizalaması)
4) Faz 5 (Policy güçlendirme)
5) Faz 6–8 (Performans/Gözlemlenebilirlik)
6) Faz 9–10 (Optimize & stabilize)
