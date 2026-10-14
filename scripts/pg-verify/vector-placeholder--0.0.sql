-- Placeholder so `vector(1536)` columns parse on a box without pgvector. Not usable for similarity search.
create type vector;
create function vector_in(cstring) returns vector language internal immutable strict as 'byteain';
create function vector_out(vector) returns cstring language internal immutable strict as 'byteaout';
create type vector (input = vector_in, output = vector_out, typmod_in = varchartypmodin, typmod_out = varchartypmodout, internallength = variable);
