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

## Acesso e privacidade

- O `mobile` agora usa sessao autenticada por `token`, nao mais apenas `userId` salvo localmente.
- O cadastro exige aceite do aviso de privacidade e do tratamento de dados sensiveis de saude.
- O app permite `exportar dados` e `excluir conta` pela aba `Perfil`.
- O `portal` exige login de instrutor.
- O `portal` agora suporta usuarios internos com perfis `admin`, `instrutor` e `visualizador`.
- O `admin` pode criar outros acessos e definir permissões por modulo no proprio portal.

Credenciais padrao locais do instrutor:

```text
email: admin@fatburn.app
senha: FatBurn@123
```

Para producao, substitua por variaveis de ambiente no backend:

```text
FATBURN_ADMIN_EMAIL
FATBURN_ADMIN_PASSWORD
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
