# Hyperliquid Integration Plan

Durum: aktif geliştirme. Fazlar onay kutuları ile takip edilir.

## Fazlar
- [x] Faz 1 — Intent tipleri ve job akışı
  - `open_position` ve `close_position` intent tipleri @copil/database içine eklendi.
  - Executor `executeTransaction` başında Hyperliquid intentleri için doğrudan `SignerService` dağıtıcısı eklendi.
- [x] Faz 2 — API servis uyarlaması
  - `createAdHocTransactionJob` Hyperliquid intentlerinde quote alımını atlar (quote=null).
  - `getQuote` Hyperliquid için 400 döner (quote gerekmiyor).
  - `sanitizeIntent` Hyperliquid intentleri normalize eder (casing, leverage/slippage clamp).
- [x] Faz 3 — SignerService Hyperliquid yürütme
  - `ExchangeClient` + `HttpTransport` ile emir gönderimi (IOC Limit) tamamlandı.
  - Fiyat/IOC limit: `allMids` + `l2Book` tepe seviye ile dinamik micro‑buffer (spread’e göre), USD→base miktar ve `szDecimals` yuvarlama.
  - Pazar sembolü → asset id (`a`) eşleme: `InfoClient.meta()` ile TTL cache.
  - `updateLeverage` (cross) ve close için reduce-only yön otomatik tespit (pozisyonlardan).
- [x] Faz 4 — Log/telemetri
  - TransactionLog.chain alanı transfer ve Hyperliquid için de doldurulur.
- [x] Faz 5 — ENV dokümantasyonu
  - Hyperliquid için ek gereksinimler ENVIRONMENT.md dosyasına işlendi.

## Sonraki Adımlar (Kritik)
- [x] Failover fiyatlama: `l2Book` ile dinamik IOC fiyat tamponu (volatiliteye duyarlı micro‑buffer).
- [x] AvailableToTrade/MaxTradeSzs denetimleri ve hata mesajları.
- [ ] (Opsiyonel) builder fee/agent onay akışı ve vault desteği.
- [ ] Rate-limit / retry/backoff sınırları ve hata mesajları sertleştirme.

## Notlar
- Hyperliquid işlemleri non-custodial imza ile HTTP API üzerinden yürütülür; on-chain RPC gerekmez.
- Hyperevm EVM tx’leri bu fazda kapsam dışıdır (gerekirse `RPC_URL_HYPERLIQUID`).
### Ek İyileştirmeler
- Kullanıcı/simge bazlı basit concurrency kilidi (in‑memory) eklendi; aynı kullanıcı aynı markette eşzamanlı iki emri tetikleyemez.
- Session key policy genişletmesi: `hlAllowedMarkets`, `hlMaxUsdPerTrade` (opsiyonel) — backend enforce eder.
- Env tabanlı IOC mikro tampon ayarları: `HL_MICRO_BUFFER_MIN_BPS`, `HL_MICRO_BUFFER_MAX_BPS`, `HL_SPREAD_MULTIPLIER`.
