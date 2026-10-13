# MySQL connection TLS

Remote MySQL connections use TLS with certificate verification enabled. If the
database server uses a private or self-signed certificate chain, provide its CA
certificate to the application:

- Set `DB_SSL_CA_PATH` to the path of the PEM CA certificate file, or
- Set `DB_SSL_CA` to the PEM certificate contents. Escaped `\n` sequences are
  converted to line breaks, so this also works as a single-line environment
  variable.

For test database settings, use `TEST_MYSQL_DB_SSL_CA_PATH` or
`TEST_MYSQL_DB_SSL_CA` instead. Configure only one CA setting for the selected
database. Local connections (`localhost`, `127.0.0.1`, or `::1`) do not use TLS.

Do not disable certificate verification to work around an untrusted chain. Obtain
the CA certificate from the database provider and ensure it is mounted or
configured securely wherever the application runs.
