SET NOCOUNT ON;
SELECT
 JSON_QUERY((SELECT s.name AS [schema],t.name AS [name],SUM(p.rows) AS [rows] FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) GROUP BY s.name,t.name ORDER BY t.name FOR JSON PATH)) AS [tables],
 JSON_QUERY((SELECT t.name AS [table],c.column_id AS [position],c.name AS [column],y.name AS [type],c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types y ON y.user_type_id=c.user_type_id ORDER BY t.name,c.column_id FOR JSON PATH)) AS [columns],
 JSON_QUERY((SELECT OBJECT_NAME(f.parent_object_id) AS [table],COL_NAME(f.parent_object_id,f.parent_column_id) AS [column],OBJECT_NAME(f.referenced_object_id) AS [target_table],COL_NAME(f.referenced_object_id,f.referenced_column_id) AS [target_column] FROM sys.foreign_key_columns f FOR JSON PATH)) AS [foreign_keys]
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
