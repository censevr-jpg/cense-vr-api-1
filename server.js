Comparando mudanças
Selecione duas ramificações para ver as alterações ou para iniciar uma nova solicitação de pull request. Se necessário, você também pode ou saiba mais sobre comparações de diferenças .
 
...
 
 Possibilidade de mesclagem. Essas ramificações podem ser mescladas automaticamente.
Discuta e analise as alterações nesta comparação com outras pessoas. Saiba mais sobre solicitações de pull request.
 1 commit
 1 arquivo alterado
 1 colaborador
Compromete-se em 20 de agosto de 2026.
Atualize o arquivo server.js

@censevr-jpg
censevr-jpg de autoria há 1 minuto
 Exibindo  com 129 adições e 4 exclusões .
  133 alterações: 129 adições e 4 exclusões133 
servidor.js
Número da linha do arquivo original	Número da linha diferente	Mudança de linha diferencial
@@ -9,7 +9,22 @@ const jwt = require('jsonwebtoken');

const  app  =  express ( ) ;
const  PORTA  =  process.env.PORTA || 3000 ;​​​​  
const  JWT_SECRET  =  process.env.JWT_SECRET || ' cense_vr_secret_2025 ' ;​​  

// O JWT_SECRET NUNCA pode ter um valor padrão fixo no código — quem teve
// acesso ao código-fonte conseguiria forjar um login válido para qualquer
// pessoa, sem saber a senha de ninguém. Por isso o servidor recusa iniciar
// sem essa variável definida de verdade no ambiente (Render → Environment).
const  JWT_SECRET  =  process.env.JWT_SECRET ;​​​​
se  ( ! JWT_SECRET )  {
  console . error ( '[FATAL] Variável de ambiente JWT_SECRET não configurada. '  +
    'Configure em Render → Ambiente antes de iniciar o servidor.' ) ;
  processo . sair ( 1 ) ;
}

// Chave de migração: protege as rotas administrativas de uso único
// (migrar usuários do formato antigo, configurações de esquema). Sem essa
// variável definida,essas rotas ficam completamente bloqueadas.
const  MIGRATION_KEY  =  process.env.MIGRATION_KEY || null ;​​​​  

const  CONNECTION_STRING  =  process.env.DATABASE_URL_SUPABASE || process.env.DATABASE_URL ;​​​​​​​​  
const  USANDO_SUPABASE  =  ! ! process . env . DATABASE_URL_SUPABASE ;
@@ -23,7 +38,7 @@ const pool = new Pool({
const  corsOptions  =  {
  origem : verdadeiro ,
  métodos : [ 'GET' , 'POST' , 'PUT' , 'DELETE' , 'OPTIONS' ] ,
  cabeçalhos permitidos : [ 'Content-Type' , 'Authorization' ] ,
  cabeçalhos permitidos : [ 'Content-Type' , 'Authorization' , 'x-migration-key' ] ,
  credenciais : falso
} ;
app.use ( cors ( corsOptions ) ) ;​​
@@ -32,7 +47,7 @@ app.options('*', cors(corsOptions));
// Capacete depois do CORS
app.use ( helmet ( { contentSecurityPolicy : false } ) ) ;​​  
app.use ( express.json ( { limit : ' 10mb ' } ) ) ;​​  
app.use ( rateLimit ( { windowMs : 15 * 60 * 10000 , max : 10000 } ) ) ;​​       
app.use ( rateLimit ( { windowMs : 15 * 60 * 1000 , max : 10000 } ) ) ;​​       

função  parseDate ( d ) {
  se ( ! d || d === '' || d === 'null' || d === 'undefined' )  retorne  nulo ;
@@ -138,7 +153,14 @@ função assíncrona initDB() {
      tipo VARCHAR(200) NOT NULL, saude_mental BOOLEAN DEFAULT false,
      obs TEXT, criado_em TIMESTAMP DEFAULT NOW()
    );
    CRIAR TABELA SE NÃO EXISTIR estado_app (
      chave VARCHAR(100) PRIMARY KEY,
      dados JSONB NÃO NULO,
      atualizar_em TIMESTAMP PADRÃO AGORA(),
      _por VARCHAR(200)
    );
  ` ) ;
  await  pool.query ( " ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matrícula VARCHAR(50) " ) ;
  const  existe  =  aguarda  piscina . query ( "SELECT id FROM usuarios WHERE nome='Gestor'" ) ;
  se  ( ! existe . linhas . comprimento )  {
    const  hash  =  await  bcrypt.hash ( ' degase2025 ' , 10 ) ; 
@@ -157,7 +179,31 @@ função auth(req, res, next) {

app.get ( ' /health' , ( req , res ) = > res.json ( { ok : true , status : 'CENSE-VR API' , time : new Date ( ) , banco : USANDO_SUPABASE ? ' Supabase' : ' Render' } ) ) ;          

app.post ( ' / api/log-acao' , auth , async ( req , res ) = > {      
  tentar  {
    const  acao  =  ( req . corpo  &&  req . corpo . acao ) ? String ( req.body.acao ) .​​​​ fatia ( 0 , 100 ) : 'Ação' ; 
    aguardar  piscina . query ( 'INSERT INTO log_acesso (usuario,acao) VALUES ($1,$2)' ,  [ req . usuario . nome ,  acao ] ) ;
    res.json ( { ok : true } ) ;​​  
  }  catch ( e )  {  res . estado ( 500 ) . json ( {  ok : false ,  erro : e.mensagem } ) ;​​  } 
} ) ;

// Trava simples usada pelas rotas administrativas de uso único abaixo.
// Sem MIGRATION_KEY configurado no ambiente, essas rotas ficam inacessíveis
// para todo mundo — inclusive para quem tenta adivinhar a URL.
função  exigirChaveMigracao ( req ,  res ) {
  se ( ! MIGRATION_KEY ) {
    res . estado ( 403 ) . json ( {  ok : false ,  erro : 'Rota desativada: MIGRATION_KEY não configurada no servidor.'  } ) ;
    retornar  falso ;
  }
  if ( req.headers [ ' x-migration-key' ] ! == MIGRATION_KEY ) {  
    res . estado ( 401 ) . json ( {  ok : false ,  erro : 'Chave de migração ausente ou incorreta.'  } ) ;
    retornar  falso ;
  }
  retornar  verdadeiro ;
}

app.get ( ' / migrate' , async ( req , res ) = > {     
  se ( ! exigirChaveMigracao ( req ,  res ) )  retornar ;
  tentar  {
    await  pool.query ( " ALTER TABLE adolescentes ADD COLUMN IF NOT EXISTS alojamento VARCHAR(20)" ) ;
    await  pool.query ( " ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matrícula VARCHAR(50) " ) ;
@@ -172,6 +218,7 @@ app.get('/migrate', async (req, res) => {
} ) ;

app.get ( ' / migrate-data-render-to-supabase' , async ( req , res ) => {     
  se ( ! exigirChaveMigracao ( req ,  res ) )  retornar ;
  if  ( ! process . env . DATABASE_URL_SUPABASE )  retorna  res . json ( {  ok : false ,  erro : 'DATABASE_URL_SUPABASE não configurado'  } ) ;
  if  ( ! process . env . DATABASE_URL_OLD_RENDER )  retorna  res . json ( {  ok : false ,  erro : 'DATABASE_URL_OLD_RENDER não configurado.'  } ) ;
  const  poolOrigem  =  new  Pool ( {  connectionString : process . env . DATABASE_URL_OLD_RENDER ,  ssl : {  rejectUnauthorized : false  }  } ) ;
@@ -200,6 +247,82 @@ app.get('/migrate-data-render-to-supabase', async (req, res) => {
  finalmente  {  await  poolOrigem.end ( ) ; await poolDestino.end ( ) ; }​​​​   
} ) ;

// ===== ESTADO DO APP (formato provisório em blob único) =====
// O frontend ainda guarda a maior parte dos dados como um pacote JSON único
// (turmas, cursos, escalas, ofícios, etc.) em vez de tabelas separadas.
// Estas rotas mantêm esse formato por enquanto, mas agora desativar login —
// só o servidor fala com o banco; o navegador nunca mais acessa direto.
const  CHAVE_ESTADO  =  'cense_vr' ;

app.get ( '/api/estado ' , auth , async ( req , res ) = > {      
  tentar  {
    const  r  =  espera  pool . query ( 'SELECT dados, atualizado_em, atualizado_por FROM estado_app WHERE chave=$1' ,  [ CHAVE_ESTADO ] ) ;
    if  ( ! r . rows . length )  retorna  res . json ( {  ok : verdadeiro ,  dados : nulo ,  atualização_em : nulo ,  atualização_por : nulo  } ) ;
    res . json ( {  ok : true ,  dados : r.rows [ 0 ] .dados , atualizado_em : r.rows [ 0 ] .atualizar_em , atualizar_por : r.rows [ 0 ] .atualizar_por } ) ;​​​​​​​​​   
  }  catch ( e )  {  res . estado ( 500 ) . json ( {  ok : false ,  erro : e.mensagem } ) ;​​  } 
} ) ;

app.get ( ' / api/estado/carimbo' , auth , async ( req , res ) = > {      
  tentar  {
    const  r  =  espera  pool . query ( 'SELECT atualização_em FROM estado_app WHERE chave=$1' ,  [ CHAVE_ESTADO ] ) ;
    if  ( ! r . rows . length )  return  res . json ( {  ok : true ,  atualizado_em : null  } ) ;
    res . json ( {  ok : true ,  atualizado_em : r.rows [ 0 ] .atualizado_em } ) ;​​​ 
  }  catch ( e )  {  res . estado ( 500 ) . json ( {  ok : false ,  erro : e.mensagem } ) ;​​  } 
} ) ;

app.put ( '/api/estado ' , auth , async ( req , res ) = > {      
  tentar  {
    const  { dados , atualizados_por }  =  req . corpo ;
    if  ( ! dados )  retorna  res . estado ( 400 ) . json ( {  ok : false ,  erro : 'Envie { dados: {...} } no corpo.'  } ) ;
    const  quem  =  atualizar_por  ||  requer . usuário ?. nome  ||  'desconhecido' ;
    const  r  =  await  pool.query (​​
      `INSERT INTO estado_app (chave, dados, atualizado_em, atualizado_por) VALUES ($1,$2,NOW(),$3)
       ON CONFLICT (chave) DO UPDATE SET dados=$2, atualizar_em=NOW(), atualizar_por=$3
       RETORNANDO __em` ,
      [ CHAVE_ESTADO ,  dados ,  quem ]
    ) ;
    res . json ( {  ok : true ,  atualizado_em : r.rows [ 0 ] .atualizado_em } ) ;​​​ 
  }  catch ( e )  {  res . estado ( 500 ) . json ( {  ok : false ,  erro : e.mensagem } ) ;​​  } 
} ) ;

// Rota de uso único: traz as senhas atuais (que já estavam em texto puro no
// blob) para a tabela relacional de usuários, com bcrypt. Protegida por
// MIGRATION_KEY, não por login — porque roda ANTES de existir qualquer
//login funcional nessa tabela. Só funciona se ainda não houver ninguém
// com matrícula cadastrada (evita rodar duas vezes por engano).
aplicativo . post ( '/api/admin/migrar-usuarios-do-blob' ,  async  ( req ,  res )  =>  {
  se ( ! exigirChaveMigracao ( req ,  res ) )  retornar ;
  tentar  {
    const  jaMigrado  =  await  pool . query ( "SELECT COUNT(*) FROM usuarios WHERE matrícula IS NOT NULL" ) ;
    if  ( parseInt ( jaMigrado . rows [ 0 ] . count ,  10 )  >  0 )  {
      retornar  res . json ( {  ok : false ,  erro : 'Já existem usuários com matrículas cadastradas — a migração não roda de novo por segurança.'  } ) ;
    }
    const  { usuários }  =  req . corpo ;
    if  ( ! Array.isArray ( usuários ) ) retorna res .​​ estado ( 400 ) . json ( { ok : false , erro : 'Envie { usuários: [...] } no corpo.' } ) ;     
    deixe  criados  =  0 ,  pulados  =  0 ;
    para  ( const  u  de  usuários )  {
      if  ( ! u . nome  ||  ! u . senha )  {  pulados ++ ;  continuar ;  }
      const  hash  =  await  bcrypt.hash ( u.senha , 10 ) ;​​​​ 
      // Se já existir alguém com esse nome (ex: o "Gestor" criado no primeiro
      //boot do servidor), atualiza em vez de duplicar.
      const  existente  =  await  pool.query ( ' SELECT id FROM usuarios WHERE LOWER( nome )=LOWER($1) ' , [ u.nome ] ) ; 
      se  ( existe . linhas . comprimento )  {
        aguarde  pool . consulta (
          'UPDATE usuários SET senha_hash=$1, perfil=$2, matrícula=$3, ativo=true WHERE id=$4' ,
          [ hash ,  você . perfil  ||  'plantação' ,  você . matrícula  ||  nulo ,  existente . linhas [ 0 ] . eu ia ]
        ) ;
      }  outro  {
        aguarde  pool . consulta (
          'INSERT INTO usuários (nome, senha_hash, perfil, matricula, ativo) VALUES ($1,$2,$3,$4,true)' ,
          [ você . nome ,  hash ,  você . perfil  ||  'plantação' ,  você . matrícula  ||  nulo ]
        ) ;
      }
      criados ++ ;
    }
    res . json ( {  ok : true , criados , pulados } ) ;
  }  catch ( e )  {  res . estado ( 500 ) . json ( {  ok : false ,  erro : e.mensagem } ) ;​​  } 
} ) ;

app.post ( '/api/login ' , async ( req , res ) = > {     
  const  { nome , senha , matrícula }  =  req . corpo ;
  const  login  =  matrícula  ||  nome ;
@@ -367,7 +490,9 @@ app.post('/api/agenda', auth, async (req,res) => {
  const  client  =  await  pool.connect ( ) ;​​
  tentar  {
    aguarde  cliente.query ( ' BEGIN ' ) ;
    const  r  =  aguarda  cliente . query ( 'INSERT INTO agenda (data,hora,tipo,carater,modalidade,escolta,viatura,observacao,registrado_por) VALORES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *' , [ data , hora , tipo , carater || 'Externa' , modalidade || 'Presencial' , escolta || null , viatura || null , observação || null , registrado_por || null ] ) ;
    // Usar nome do usuário autenticado se não for registrado_por
    const  nomeRegistrador  =  registrado_por  ||  requer . usuário ?. nome  ||  'Sistema' ;
    const  r  =  aguarda  cliente . query ( 'INSERT INTO agenda (data,hora,tipo,carater,modalidade,escolta,viatura,observacao,registrado_por) VALORES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *' , [ data , hora , tipo , carater || 'Externa' , modalidade || 'Presencial' , escolta || null , viatura || null , observação || null , nomeRegistrador ] ) ;
    se  ( adolescentes  &&  adolescentes.comprimento ) {​​ 
      for  ( const  aid  of  adolescentes )  await  client . query ( 'INSERT INTO agenda_adolescentes (agenda_id,adolescente_id) VALUES ($1,$2)' , [ r . rows [ 0 ] . id , aid ] ) ;
    }
Rodapé
© 2026 GitHub, Inc.
Navegação do rodapé
Termos
Privacidade
Segurança
Status
Comunidade
Documentos
Contato
Gerenciar cookies
Não compartilhe minhas informações pessoais.
