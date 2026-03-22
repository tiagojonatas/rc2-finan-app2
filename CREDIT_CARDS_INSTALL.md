# Sistema de Cartões de Crédito - Guia de Instalação

## 📋 Resumo das Novas Funcionalidades

O sistema agora suporta **gerenciamento de cartões de crédito** com as seguintes funcionalidades:

- ✅ Criar múltiplos cartões de crédito
- ✅ Definir limite e datas de fechamento/vencimento
- ✅ Rastrear gastos por cartão
- ✅ Calcular disponibilidade de limite automaticamente
- ✅ Editar e deletar cartões
- ✅ Histórico completo de transações por cartão

## 🗄️ Tabelas do Banco de Dados

### `credit_cards`
Armazena informações dos cartões de crédito:
- `id` - Identificador único
- `user_id` - Associação com usuário
- `name` - Nome do cartão (ex: "Cartão Principal")
- `limit_amount` - Limite de crédito em reais
- `closing_day` - Dia do fechamento da fatura (1-31)
- `due_day` - Dia do vencimento (1-31)
- `created_at` - Data de criação

### `card_transactions`
Registra gastos feitos com cartões:
- `id` - Identificador único
- `card_id` - Associação com cartão
- `description` - Descrição do gasto
- `amount` - Valor do gasto
- `date` - Data do gasto
- `created_at` - Data de criação

## 🚀 Instalação

### 1. Criar as Tabelas no Banco de Dados

Execute o seguinte comando para criar as tabelas de cartão de crédito:

```bash
npm run init-credit-cards
```

Você deve ver a mensagem:
```
Connected to MySQL database
Credit cards schema initialized successfully
```

### 2. Verificar a Instalação

1. Faça login no sistema
2. Clique no botão "💳 Cartões" na barra de navegação do dashboard
3. Você deverá ver a página de gerenciamento de cartões

## 📍 Rotas Disponíveis

### Dashboard
- `GET /` - Página inicial
- `GET /dashboard` - Dashboard com transações

### Cartões de Crédito
- `GET /credit-cards` - Listar todos os cartões
- `GET /credit-cards/add` - Formulário para novo cartão
- `POST /credit-cards/add` - Criar novo cartão
- `GET /credit-cards/edit/:id` - Formulário para editar cartão
- `POST /credit-cards/edit/:id` - Atualizar cartão
- `POST /credit-cards/delete/:id` - Deletar cartão

### Transações de Cartão
- `GET /credit-cards/:id/transactions` - Listar transações do cartão
- `GET /credit-cards/:id/add-transaction` - Formulário para novo gasto
- `POST /credit-cards/:id/add-transaction` - Registrar gasto
- `GET /credit-cards/:id/edit-transaction/:transactionId` - Editar gasto
- `POST /credit-cards/:id/edit-transaction/:transactionId` - Atualizar gasto
- `POST /credit-cards/:id/delete-transaction/:transactionId` - Deletar gasto

## 💡 Não Impactado

O sistema de **transações existente** foi mantido intacto:
- ✅ Transações de entrada/despesa continuam funcionando
- ✅ Dashboard original continua disponível
- ✅ Limite e controle de permissões intactos

## 🎨 Interface

### Página de Cartões
- Visualiza todos os cartões em cards
- Mostra limite total, dias de fechamento e vencimento
- Botões rápidos para adicionar gastos, editar ou deletar

### Transações do Cartão
- Tabela com todos os gastos
- Cálculo automático de:
  - Total gasto no mês
  - Limite disponível
- Ações para editar ou deletar cada transação

### Máscara de Moeda
- Formatação automática: `1.234,56` (padrão brasileiro)
- Aceita apenas dígitos
- Converte automaticamente ao enviar: `1234.56`

## 📝 Exemplo de Uso

1. **Criar um cartão:**
   - Nome: "Nubank"
   - Limite: 5.000,00
   - Fechamento: 5º
   - Vencimento: 15º

2. **Adicionar gasto:**
   - Descrição: "Supermercado"
   - Valor: 150,50
   - Data: hoje

3. **Visualizar status:**
   - Limite total: R$ 5.000,00
   - Gasto mês: R$ 150,50
   - Disponível: R$ 4.849,50

## 🔧 Solução de Problemas

### Erro: "Table already exists"
As tabelas já foram criadas. Você pode prosseguir normalmente.

### Erro de conexão MySQL
Verifique:
- MySQL está rodando
- Credenciais em `.env` estão corretas
- Banco de dados especificado existe

### Masks não aparecem
Verifique se JavaScript está habilitado no navegador.

## 📚 Arquivos Criados

- `schema-credit-cards.sql` - Script SQL das tabelas
- `routes/credit-cards.js` - Rotas e lógica
- `init-credit-cards.js` - Script de inicialização
- `views/credit-cards.ejs` - Listagem de cartões
- `views/add-credit-card.ejs` - Criar cartão
- `views/edit-credit-card.ejs` - Editar cartão
- `views/card-transactions.ejs` - Transações do cartão
- `views/add-card-transaction.ejs` - Criar gasto
- `views/edit-card-transaction.ejs` - Editar gasto

## 🎯 Próximos Passos

Após completar a instalação, você pode:
1. Adicionar mais cartões
2. Rastrear gastos
3. Monitorar disponibilidade de limite
4. Continuar usando o sistema de transações normalmente
