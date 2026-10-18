import { sql } from "../lib/db";
console.log(await sql()`select name, role, verification->'titleWas' was, verification->'titleDropped' dropped, verification->'gone' gone from contacts where verification ? 'titleWas' or role_status='departed'`);
