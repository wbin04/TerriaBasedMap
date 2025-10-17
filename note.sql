# Drop và tạo lại database
psql -U postgres -c "DROP DATABASE IF EXISTS dthubdb_tree;"
psql -U postgres -c "CREATE DATABASE dthubdb_tree OWNER dthubuser;"

# Enable PostGIS trước khi restore
psql -U postgres -d dthubdb_tree -c "CREATE EXTENSION postgis;"

# Restore backup
psql -U dthubuser -d dthubdb_tree -f backup.sql