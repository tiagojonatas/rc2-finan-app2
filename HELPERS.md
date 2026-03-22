# Sistema Financeiro - Funções Helper

## Funções Helper Disponíveis

As seguintes funções helper estão disponíveis globalmente em todos os templates EJS:

### formatCurrency(value)

Formata um valor numérico para o formato de moeda brasileira (R$).

**Parâmetros:**
- `value` (number|string): Valor numérico a ser formatado

**Retorno:** String formatada (ex: "R$ 1.500,00")

**Exemplo de uso:**
```ejs
<%= formatCurrency(1500.50) %> <!-- Resultado: R$ 1.500,50 -->
<%= formatCurrency(transaction.amount) %> <!-- Resultado: R$ 250,00 -->
```

### formatDate(date, options)

Formata uma data para o formato brasileiro.

**Parâmetros:**
- `date` (Date|string): Data a ser formatada
- `options` (object, opcional): Opções de formatação do Intl.DateTimeFormat

**Retorno:** String da data formatada

**Exemplo de uso:**
```ejs
<%= formatDate(new Date()) %> <!-- Resultado: 22/03/2026 -->
<%= formatDate(transaction.date, { month: 'long' }) %> <!-- Resultado: 22 de março -->
```

### formatTime(date, options)

Formata um horário para o formato brasileiro.

**Parâmetros:**
- `date` (Date|string): Data/hora a ser formatada
- `options` (object, opcional): Opções de formatação do Intl.DateTimeFormat

**Retorno:** String do horário formatado

**Exemplo de uso:**
```ejs
<%= formatTime(new Date()) %> <!-- Resultado: 14:30 -->
<%= formatTime(transaction.date) %> <!-- Resultado: 09:15 -->
```

## Implementação

As funções helper são definidas no arquivo `helpers.js` e estão disponíveis globalmente em todos os templates EJS através da configuração no `app.js`.

## Tratamento de Erros

Todas as funções incluem tratamento robusto de valores nulos, undefined e inválidos:

- `formatCurrency(null)` → `"R$ 0,00"`
- `formatDate(null)` → `""`
- `formatTime(null)` → `""`

## Exemplo Completo

```ejs
<div class="transaction">
  <h3><%= transaction.description %></h3>
  <p>Valor: <%= formatCurrency(transaction.amount) %></p>
  <p>Data: <%= formatDate(transaction.date) %></p>
  <p>Hora: <%= formatTime(transaction.date) %></p>
</div>
```