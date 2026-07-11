const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function run() {
  const configPath = path.resolve(__dirname, '../config/database.local.json');
  const schemaPath = path.resolve(__dirname, '../packages/database/schema.sql');

  if (!fs.existsSync(configPath)) {
    console.error(`Error: config file not found at ${configPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(schemaPath)) {
    console.error(`Error: schema file not found at ${schemaPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log(`Attempting to connect to MySQL at ${config.host}:${config.port} as ${config.user}...`);

  try {
    // Conecta inicialmente sem especificar banco de dados para podermos cria-lo
    const connection = await mysql.createConnection({
      host: config.host || '127.0.0.1',
      port: config.port || 3306,
      user: config.user || 'root',
      password: config.password || '',
      multipleStatements: true // Permite rodar varias queries juntas
    });

    console.log('Connected successfully. Running schema.sql statements...');
    
    // Executa as queries do schema.sql
    await connection.query(schemaSql);
    
    console.log('Database and tables created successfully in "skymp_rp"!');
    await connection.end();
    process.exit(0);
  } catch (err) {
    console.error('Failed to set up database:', err.message);
    console.log('\n--- Troubleshooting ---');
    console.log('Please make sure your MySQL/MariaDB server is running and the credentials in skymp/config/database.local.json are correct.');
    process.exit(1);
  }
}

run();
