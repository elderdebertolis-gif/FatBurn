# FatBurn

Aplicacao de treino e acompanhamento fisico com:

- `mobile`: app Expo + React Native
- `backend`: API Node.js com PostgreSQL
- `portal`: painel web do instrutor

## Estrutura

```text
FatBurn/
├── backend/
├── mobile/
└── portal/
```

## Execucao local

Backend:

```bash
cd backend
npm install
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

## Credenciais locais do portal

```text
email: admin@fatburn.app
senha: FatBurn@123
```

## Variaveis de ambiente do backend

```text
DATABASE_URL
FATBURN_ADMIN_EMAIL
FATBURN_ADMIN_PASSWORD
PGSSL
RESEND_API_KEY
EMAIL_FROM
```

Observacoes:

- `DATABASE_URL` deve apontar para o banco PostgreSQL do ambiente.
- `PGSSL=true` so e necessario quando a conexao exigir SSL.
- `RESEND_API_KEY` e `EMAIL_FROM` habilitam o envio de codigo para redefinicao de senha.
- `EMAIL_FROM` deve ser um remetente valido no provedor configurado.

## Teste no celular fisico

Dentro de `mobile/`, defina o IP da maquina antes de iniciar o Expo:

```bash
$env:EXPO_PUBLIC_API_URL="http://SEU_IP_LOCAL:3030"
npm start
```

Exemplo:

```bash
$env:EXPO_PUBLIC_API_URL="http://10.19.136.243:3030"
npm start
```
