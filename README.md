# FatBurn

Projeto reorganizado em tres frentes:

```text
FatBurn/
├── backend/
├── mobile/
└── portal/
```

## Estrutura

- `backend/`
  API Node.js, regras de treino e base SQLite local em `backend/data/`.

- `portal/`
  Pagina web do instrutor, servida pelo backend.

- `mobile/`
  Aplicativo Expo + React Native.

## Como executar

Backend:

```bash
cd backend
npm run start
```

Mobile:

```bash
cd mobile
npm start
```

Portal:

```text
http://localhost:3030
```

## Teste no celular fisico

Dentro de `mobile/`, defina o IP da maquina antes de subir o Expo:

```bash
$env:EXPO_PUBLIC_API_URL="http://SEU_IP_LOCAL:3030"
npm start
```

Exemplo:

```bash
$env:EXPO_PUBLIC_API_URL="http://10.19.136.243:3030"
npm start
```
