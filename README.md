# Estacionamento Anita — app de gestão

App web instalável (PWA) para o celular. Ele cuida de:

- **Hoje**: lançamento do dia carro a carro (paga, cortesia, Sulgás, retorno), caixa por forma de pagamento e equipe presente. O prêmio do dia aparece na hora.
- **Mês**: receita, estacionamento × lavagens, meta mensal, gráfico diário, despesas e resultado.
- **Equipe**: prêmio diário e bônus mensal de cada um, presença (regra dos 80%), salário, VT, extras e descontos, total a pagar, cadastro dos funcionários e **demonstrativo mensal** para imprimir (cláusula 4.3 do regulamento).
- **Sulgás**: lavagens do período de faturamento (dia 19 ao dia 18), com placa e usuário, total a faturar e cadastro da frota.
- **Ajustes**: regras de premiação (vigência, faixas, sábado, bônus), botões de preço, despesas fixas, importação do histórico e backup.

As regras seguem o **Regulamento do Programa de Premiação da Lavagem**:

- Contam como veículo: pagas, Sulgás e cortesias. Retorno e lavagem cancelada não contam.
- Base de cálculo = valor cobrado das pagas + Sulgás pelo valor do contrato. Cortesia entra com valor zero.
- De segunda a sexta:

  | Veículos no dia | Prêmio por pessoa |
  |---|---|
  | até 2 | 0 |
  | 3 a 7 | 4,5% |
  | 8 ou 9 | 5% |
  | 10 ou mais | 5,25% |

- Sábado com 2 ou mais veículos: 4,5%.
- Bônus mensal: R$ 50 (140+ veículos), R$ 60 (160+), R$ 80 (200+), R$ 100 (240+). Só recebe quem trabalhou pelo menos 80% dos dias previstos.

Dias antes da data de vigência usam a regra antiga, com o prêmio importado da planilha.

---

## 1. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `anita-app`).
2. Envie os arquivos desta pasta. Pelo site, use **Add file → Upload files** e arraste tudo. Pelo terminal:
   ```
   git remote add origin https://github.com/SEU_USUARIO/anita-app.git
   git push -u origin main
   ```
3. No repositório, abra **Settings → Pages → Source: Deploy from a branch → main / (root)** e salve.
4. Em 1 ou 2 minutos o app estará em `https://SEU_USUARIO.github.io/anita-app/`.

> O `historico.json` **não** vai para o GitHub (o `.gitignore` bloqueia). O repositório do Pages gratuito é público, e esse arquivo tem salários e faturamento. Você importa o histórico direto no app (passo 4).

## 2. Criar o Firebase (banco na nuvem)

1. Acesse https://console.firebase.google.com, clique em **Adicionar projeto** e dê um nome (ex.: `anita-estacionamento`). O Analytics pode ficar desligado.
2. **Firestore Database**:
   1. Clique em **Criar banco de dados**, escolha o local `southamerica-east1` (São Paulo) e o modo de produção.
   2. Na aba **Regras**, cole o conteúdo de `firestore.rules`, troque `SEU_EMAIL_AQUI@gmail.com` pelo seu e-mail e clique em **Publicar**.
3. **Authentication**:
   1. Clique em **Vamos começar** e ative **E-mail/senha**.
   2. Na aba **Usuários**, use **Adicionar usuário** para criar seu login, com o mesmo e-mail colocado nas regras.
   3. Em **Configurações → Domínios autorizados**, adicione `SEU_USUARIO.github.io`.
4. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone **Web `</>`**:
   1. Registre o app.
   2. Copie o bloco `const firebaseConfig = { ... }`.

## 3. Conectar o app

A configuração do projeto `anita-estacionamento` já está no código (`js/store.js`). Basta abrir o endereço do GitHub Pages e entrar com o e-mail e a senha criados no passo 2.3.

## 4. Importar o histórico (uma vez só)

1. Em **Ajustes**, toque em **Importar histórico (.json)**.
2. Escolha o `historico.json`, que tem todo o histórico de abril de 2024 a novembro de 2026.
3. Depois de importar, apague o arquivo do celular se quiser. Os dados ficam no seu Firebase.

## 5. Ícone na tela de início

- **iPhone (Safari)**: toque em Compartilhar → **Adicionar à Tela de Início**.
- **Android (Chrome)**: menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**).

## Backup em Excel

- **Na hora:** no app, abra **Ajustes → Backup em Excel** e escolha **Baixar Excel** ou **Enviar por e-mail**. No celular, "Enviar por e-mail" abre o compartilhamento.
- **Automático todo dia 15:** o GitHub Actions (`.github/workflows/backup.yml`) gera o mesmo Excel e envia para anitaparkingpoa@gmail.com.
  - Para enviar na hora, abra **Actions → Backup mensal por e-mail → Run workflow**.
  - Ele precisa de 3 segredos em **Settings → Secrets and variables → Actions**:
    - `APP_EMAIL` e `APP_SENHA`: o login do app.
    - `GMAIL_SENHA_APP`: senha de app do Gmail anitaparkingpoa@gmail.com, criada em myaccount.google.com/apppasswords (a verificação em 2 etapas precisa estar ativa).

## Incluir os sócios depois

1. Crie o login de cada sócio em Authentication → Usuários.
2. Acrescente o e-mail dele na lista de `firestore.rules` e publique.
3. Ele abre o mesmo endereço, cola a mesma configuração e entra.

## Atualizar o app

1. Edite os arquivos e faça o envio para o GitHub.
2. Aumente a versão em `sw.js` (`anita-v1` → `anita-v2`) para os celulares pegarem a versão nova.

## Estrutura

```
index.html            página do app
styles.css            visual
js/calc.js            regras do regulamento e cálculos (prêmio, folha, resultado)
js/store.js           banco: Firebase ou local no aparelho
js/app.js             telas
manifest.webmanifest  instalação no celular
sw.js                 funcionamento offline
firestore.rules       quem pode acessar os dados
```

Dados no Firestore: `config/app`, `funcionarios/{id}`, `frota/lista`, `meses/{AAAA-MM}` (um documento por mês com dias, despesas e folha).
