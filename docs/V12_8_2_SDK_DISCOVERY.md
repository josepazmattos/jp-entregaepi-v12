# JP Biometria 12.8.2 — localização do SDK Java

## Motivo

O agente 12.8.1 respondia na porta 8789 com `SDK_NOT_FOUND`. Esse resultado indica
que havia Java utilizável na inicialização, mas o JAR do SDK não foi encontrado.
O histórico de setembro registra captura Java real e o agente 11.9.0 com SDK,
Java amd64 e leitor FDU01 reconhecido. O HFDU06 atual ainda requer teste físico.

A comparação do fonte original da V11.9 revelou uma regressão: além dos caminhos
conhecidos, ela procurava `Lib/NBioBSPJNI.jar` em subpastas de Program Files.
A 12.8.1 deixou apenas caminhos fixos. Isso explica a falha para instalações em
pastas diferentes, mas não comprova onde o SDK está instalado no computador atual.

## Alterações

- Recupera a busca em subpastas das pastas de instalação e de C:\NITGEN, com
  limite de tempo, profundidade e quantidade de entradas; não segue links.
- Exige as duas DLLs presentes e da mesma arquitetura antes de selecionar Java.
- Ao iniciar pelo protocolo, reavalia um diagnóstico de Java/SDK e reinicia
  somente a instância autenticada quando o resultado de descoberta mudou.
- Mantém o contrato de captura compatível com 12.8.1. A ficha, as empresas e
  as regras de registro biométrico permanecem nas implementações atuais.
- Publica reparador 12.8.2 sem incluir Java, driver, SDK ou chaves do fabricante.

## Validação

Os testes de regressão reproduzem a pasta personalizada ignorada pela lista
fixa, instalação incompleta coexistindo com outra completa, limites de busca,
links e arquitetura. O teste Windows instala o executável da publicação,
acrescenta um SDK sintético em pasta personalizada e verifica a redescoberta
pelo protocolo. DLLs sintéticas devem retornar SDK_LOAD_FAILED, nunca leitor pronto.

A execução da suíte e da instalação Windows é obrigatória no workflow antes de
publicar. Nenhum teste automatizado comprova captura USB física do usuário.

## Uso no computador do leitor

Instalar/reparar com JP-Biometria-Setup-12.8.2.exe e depois usar Verificar leitor
e Testar captura. Se SDK_NOT_FOUND persistir, instalar o SDK eNBioBSP com
NBioBSPJNI.jar; o driver USB não contém essa integração. Após a instalação,
Iniciar JP Biometria passa a reavaliar o runtime sem exigir novo reparo.
