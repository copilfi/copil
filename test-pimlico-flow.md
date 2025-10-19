# 🧪 Pimlico & Smart Account Deployment Test Suite

## 📋 Ön Bilgi

### Pimlico'nun Rolü
- **Bundler**: UserOperation'ları paketler ve Entry Point'e gönderir
- **Account Abstraction**: ERC-4337 standardını destekler
- **Smart Account Deploy**: initCode ile kontrat dağıtımı yapar
- **Gas Sponsorship**: Paymaster desteği (opsiyonel)

### API Key
```
PIMLICO_API_KEY=pim_5JizozeNzY9MnAq1TX22TEs
```

### Bundler Endpoints (Chain ID bazlı)
- Ethereum (1): `https://api.pimlico.io/v2/1/rpc?apikey=...`
- Base (8453): `https://api.pimlico.io/v2/8453/rpc?apikey=...`
- Arbitrum (42161): `https://api.pimlico.io/v2/42161/rpc?apikey=...`

---

## 🚀 Test Senaryoları

### Test 1: Login ve JWT Alma
```bash
# API çalıştığından emin olun
# Terminal 1: npm run dev (tüm servisler)

# JWT token alın
JWT=$(curl -s -X POST http://localhost:4311/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"privyDid":"dev:local","email":"dev@copil.io"}' \
  | jq -r .access_token)

echo "JWT Token: $JWT"
```

**Beklenen Sonuç:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "dev@copil.io",
    "privyDid": "dev:local"
  }
}
```

---

### Test 2: Session Key Kontrolü
```bash
# Mevcut session key'leri listele
curl -s -H "Authorization: Bearer $JWT" \
  http://localhost:4311/session-keys | jq

# Eğer yoksa, yeni session key oluştur
# Not: SESSION_KEY_PRIVATE_KEY .env'de tanımlı olmalı
# Bu private key'den türetilen public adresi kullanın

# Örnek session key oluşturma
curl -s -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "publicKey": "0xYourSessionKeyPublicAddress",
    "permissions": {
      "actions": ["swap", "bridge", "custom"],
      "chains": ["ethereum", "base", "arbitrum", "linea"],
      "allowedContracts": [],
      "spendLimits": []
    }
  }' http://localhost:4311/session-keys | jq
```

**Beklenen Sonuç:**
```json
{
  "id": 1,
  "userId": 1,
  "publicKey": "0x...",
  "permissions": { ... },
  "isActive": true
}
```

---

### Test 3: Smart Account Adres Hesaplama
```bash
# Kullanıcının EOA adresinden Smart Account adresini hesapla
# Bu adım otomatik yapılır, ancak manuel kontrol için:

curl -s -H "Authorization: Bearer $JWT" \
  http://localhost:4311/smart-account/address?chain=base | jq
```

**Beklenen Sonuç:**
```json
{
  "chain": "base",
  "smartAccountAddress": "0x...",
  "isDeployed": false
}
```

---

### Test 4: Smart Account Deployment (Ana Test)
```bash
# Base chain'de Smart Account deploy et
curl -s -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "chain": "base",
    "sessionKeyId": 1
  }' http://localhost:4311/smart-account/deploy | jq

# Değişkenler:
# - chain: "ethereum" | "base" | "arbitrum" | "linea" | "optimism" | "polygon" | "bsc" | "avalanche"
# - sessionKeyId: Session key ID (Test 2'den alınan)
```

**Beklenen Sonuç:**
```json
{
  "jobId": "12345",
  "smartAccountAddress": "0x..."
}
```

---

### Test 5: Transaction Log Kontrolü
```bash
# Deploy işleminin durumunu kontrol et
curl -s -H "Authorization: Bearer $JWT" \
  http://localhost:4311/transaction/logs | jq

# Son 5 log kaydını filtrele
curl -s -H "Authorization: Bearer $JWT" \
  http://localhost:4311/transaction/logs | jq '.[0:5]'
```

**Beklenen Sonuç:**
```json
[
  {
    "id": 1,
    "userId": 1,
    "strategyId": null,
    "description": "Smart Account deployment on base",
    "txHash": "0x...",
    "chain": "base",
    "status": "success",
    "createdAt": "2025-10-18T..."
  }
]
```

---

### Test 6: Deployment Doğrulama (On-Chain)
```bash
# Smart Account'un deploy edildiğini kontrol et
# viem/ethers ile contract code check

# Option 1: cast (Foundry) ile
cast code <SMART_ACCOUNT_ADDRESS> --rpc-url https://base-mainnet.g.alchemy.com/v2/...

# Option 2: curl + JSON-RPC
curl -X POST https://base-mainnet.g.alchemy.com/v2/YOUR_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getCode",
    "params": ["<SMART_ACCOUNT_ADDRESS>", "latest"],
    "id": 1
  }' | jq
```

**Beklenen Sonuç:**
- Deploy öncesi: `"0x"` (boş)
- Deploy sonrası: `"0x60806040..."` (bytecode)

---

### Test 7: Supported Chains Kontrolü
```bash
# Deployment için desteklenen zincirleri listele
curl -s -H "Authorization: Bearer $JWT" \
  http://localhost:4311/transaction/chains | jq
```

**Beklenen Sonuç:**
```json
{
  "supported": [
    "ethereum",
    "base",
    "arbitrum",
    "linea",
    "optimism",
    "polygon",
    "bsc",
    "avalanche"
  ],
  "seiSupport": "native-client"
}
```

---

## 🔍 Pimlico Bundler İç İşleyişi

### 1. UserOperation Yapısı
```typescript
interface UserOperation {
  sender: Address;           // Smart Account address
  nonce: bigint;            // Account nonce
  initCode: Hex;            // Deployment code (ilk işlemde)
  callData: Hex;            // Execution data
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;    // Paymaster bilgisi
  signature: Hex;           // Session key signature
}
```

### 2. İlk Deploy UserOperation
```javascript
{
  sender: "0xSmartAccountAddress",  // Henüz deploy edilmemiş
  nonce: 0n,
  initCode: "0x<factory><factoryData>",  // ← Safe kontrat deploy kodu
  callData: "0x",  // İlk işlem boş (sadece deploy)
  signature: "0x...",  // Session key imzası
  // ... gas parametreleri
}
```

### 3. Sonraki UserOperation'lar
```javascript
{
  sender: "0xSmartAccountAddress",  // Artık deploy edilmiş
  nonce: 1n,
  initCode: "0x",  // ← Artık boş (deploy edilmiş)
  callData: "0x<functionSelector><params>",  // Gerçek işlem
  signature: "0x...",
  // ... gas parametreleri
}
```

---

## 🎯 Kritik Kontrol Noktaları

### ✅ Başarı Kriterleri:
1. **JWT Token alındı** (Test 1)
2. **Session Key aktif** (Test 2)
3. **Smart Account adresi hesaplandı** (Test 3)
4. **Deploy job kuyruğa alındı** (Test 4)
5. **Transaction log "success" durumunda** (Test 5)
6. **On-chain bytecode mevcut** (Test 6)

### ⚠️ Yaygın Hatalar:
1. **"SESSION_KEY_PRIVATE_KEY not found"**
   - `.env` dosyasında key eksik
   - Çözüm: Private key ekleyin

2. **"Insufficient funds for gas"**
   - Smart Account'da gas için ETH yok
   - Çözüm: Paymaster kullanın veya hesaba ETH gönderin

3. **"Policy rejected: contract not allowed"**
   - `allowedContracts` whitelist'inde Smart Account yok
   - Çözüm: Deployment öncesi whitelist'e ekleyin

4. **"Bundler error: AA21 didn't pay prefund"**
   - Paymaster veya hesap gas ödeyemiyor
   - Çözüm: Hesaba ETH gönderin veya paymaster ayarlayın

---

## 📊 Test Sonuç Tablosu

| Test # | İşlem | Durum | Notlar |
|--------|-------|-------|--------|
| 1 | Login | ⏳ | JWT alınacak |
| 2 | Session Key | ⏳ | Key kontrolü |
| 3 | Address Calc | ⏳ | Counterfactual adres |
| 4 | Deploy Job | ⏳ | BullMQ job |
| 5 | Log Check | ⏳ | Success/fail |
| 6 | On-chain Verify | ⏳ | Bytecode kontrolü |
| 7 | Chains List | ⏳ | Desteklenen ağlar |

---

## 🔗 İlgili Dosyalar

### Backend:
- `apps/api/src/smart-account/smart-account.controller.ts`
- `apps/api/src/smart-account/smart-account.service.ts`
- `apps/api/src/auth/smart-account.service.ts` (adres hesaplama)
- `apps/transaction-executor/src/execution/execution.service.ts`
- `apps/transaction-executor/src/signer/signer.service.ts`
- `apps/transaction-executor/src/clients/bundler.client.ts`

### Config:
- `apps/api/.env` (PIMLICO_API_KEY)
- `apps/transaction-executor/.env` (SESSION_KEY_PRIVATE_KEY)

---

## 📚 Referanslar

- [ERC-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)
- [Pimlico Documentation](https://docs.pimlico.io)
- [Safe Smart Account](https://docs.safe.global)
- [Permissionless.js](https://docs.pimlico.io/permissionless)

---

## 🚦 Sonraki Adımlar

1. ✅ Testleri sırayla çalıştırın
2. 📊 Her adımın loglarını kaydedin
3. 🔍 Hata durumunda debug bilgilerini toplayın
4. 📝 Production için checklist oluşturun:
   - [ ] Gerçek API key'ler
   - [ ] Paymaster konfigürasyonu
   - [ ] Gas limit optimizasyonu
   - [ ] Multi-chain test coverage
