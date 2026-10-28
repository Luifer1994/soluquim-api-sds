# API SDS de Soluquim

Microservicio de **generación de Fichas de Datos de Seguridad (FDS / SDS)**. Está hecho en **NestJS + TypeScript**. Usa la infraestructura compartida de Soluquim (gateway, RabbitMQ, WebSocket, Gotenberg) y tiene **su propia base de datos** (PostgreSQL 16 + pgvector).

Diseño completo, fases y decisiones: [PLAN-FDS-MICROSERVICIO.md](../PLAN-FDS-MICROSERVICIO.md).

> **Estado:** consulta **8 fuentes** a la vez, guarda los datos **versionados** en la BD propia, los **vectoriza (RAG con pgvector)** y un **agente de IA** redacta el borrador de las 16 secciones de la FDS. Falta el motor de clasificación SGA de mezclas (Fase 3).

---

## Cómo se levanta

Igual que los demás micros: desde el repo **soluquim-docker**, con su `docker-compose`. No tiene compose propio.

```bash
cp soluquim-api-sds/.env.example soluquim-api-sds/.env   # una vez, como con los micros Java
make up            # todo el stack (incluye sds-postgres, sds y sds-worker)
make logs-sds      # logs de la API y del worker
make sds-test      # tests dentro del contenedor
make sds-lint      # ESLint dentro del contenedor
make sds-db-shell  # psql en la BD propia
make sds-db-reset  # borra y recrea SOLO la BD del SDS (bloqueado en prod)
make sds-migration NAME=add_algo   # nueva migración Prisma (dev)
```

### Puertos

| Qué | Dev | QA / Prod |
|---|---|---|
| API (`sds`) | `SDS_PORT` (8084), **publicado** como los Java → http://localhost:8084/ | interno `8080` (como los Java), **no** se publica |
| BD propia (`sds-postgres`) | host `SDS_DB_PORT` (5439) → 5432. El Postgres principal usa 5438. | igual, pero con `SDS_DB_BIND=127.0.0.1` |
| Debugger de Node | host `SDS_DEBUG_PORT` (9229) | — |
| Worker / migrador | sin puertos | sin puertos |

En dev, `http://localhost:8084/` responde *"Soluquim SDS API Service is running!"*, igual que los micros Java. Ese acceso directo es para probar. **El front lo consume siempre por el gateway**: `http://localhost:8080/api/sds/**`. Por ahora la ruta **no exige autenticación** (decisión de la fase inicial). El gateway borra los headers `X-User-*`, para que nadie pueda hacerse pasar por un usuario con permisos. Antes de exponer endpoints de negocio hay que volver a poner `AuthenticationFilter` en la ruta `sds-service` de `soluquim-api-gateway/src/main/resources/application.yml`.

### Hot reload (dev)

Al guardar cualquier archivo de `src/`, la API y el worker recompilan, con chequeo de tipos, y se reinician solos en **unos 2-3 s**. No hace falta reiniciar contenedores.

| Si cambias… | Qué pasa / qué hacer |
|---|---|
| Código en `src/` | Se recarga solo (API y worker). Si hay error de tipos, aparece en `make logs-sds` y no se reinicia hasta que se corrija. |
| `prisma/schema.prisma` | `make sds-migration NAME=descripcion`: crea la migración, la aplica y reinicia API y worker. Cada uno regenera su cliente de Prisma. |
| `package.json` (dependencias) | `make sds-restart`: reinstala dependencias en los dos contenedores al arrancar. |
| `soluquim-api-sds/.env` o variables `SDS_*` del `.env` raíz | `make sds-restart`. |

Si al guardar no se recarga (pasa en Windows cuando el código está fuera del filesystem de WSL), pon `SDS_WATCH_POLLING=true` en el `.env` raíz y corre `make sds-restart`. Con polling la recarga tarda unos 5-6 s.

Debug: adjuntar el debugger de VS Code (Node, *attach*) a `localhost:9229`.

### Contenedores

| Contenedor | Qué es |
|---|---|
| `soluquim-sds-postgres` | BD **propia** (`pgvector/pgvector:pg16`, BD `soluquim_sds`). |
| `soluquim-sds` | API HTTP. Publica tareas y **no** consume la cola. En dev aplica las migraciones al arrancar. Es la que corre los seeders. |
| `soluquim-sds-worker` | Misma imagen, sin HTTP (`SDS_PROCESS=worker`). Consume `soluquim.sds.tasks.q`. |
| `soluquim-sds-migrate` | Solo QA/Prod: aplica las migraciones y termina; la API espera a que acabe bien. |

- **Dev** (`docker-compose/node/Dockerfile`): el código se monta como volumen y hay hot reload. `node_modules` y `dist` viven en volúmenes nombrados, uno por contenedor. `npm ci` solo se vuelve a correr si cambia `package.json`, `package-lock.json` o `prisma/schema.prisma`.
- **QA/Prod** (`docker-compose/node/Dockerfile.prod`): build multi-stage. La imagen final lleva solo `dist` y las dependencias de producción, corre con usuario `node`, y el CLI de Prisma va en una imagen aparte (`target: migrator`). En prod: `restart: always` y límite de 512 MB, como los Java.

### Variables de entorno (mismo esquema que los micros Java)

| Dónde | Qué va |
|---|---|
| `.env` **raíz** de soluquim-docker (única fuente de verdad, vía `environment:`) | BD (`SDS_DB_*`), puertos (`SDS_PORT`, `SDS_DEBUG_PORT`) y los flags de **DATOS Y ARRANQUE**: `DB_RESET`, `APP_SEED_ENABLED`, `APP_SEED_DEMO`. |
| `soluquim-api-sds/.env` (vía `env_file:`) | Lo propio del servicio: `LOG_LEVEL`, `SWAGGER_ENABLED`, `WORKER_CONCURRENCY` y, en fases siguientes, las claves de LLM o de APIs externas. Ver `.env.example`. |

La app valida su configuración al arrancar ([env.schema.ts](src/shared/config/env.schema.ts)) y no levanta si falta algo.

**Datos y arranque**, con la misma semántica que en core, auth y tenant:
- `DB_RESET=true` + `make up` → borra **también** la BD del SDS y la recrea desde las migraciones.
- `APP_SEED_ENABLED=true` → corre los seeders de catálogo (`kind: 'catalog'`).
- `APP_SEED_DEMO=true` → corre los seeders demo (`kind: 'demo'`).
- `make up` vuelve los tres flags a `false` (one-shot). Solo siembra el proceso API, nunca el worker.

**Crear un seeder**: un provider con `@Seeder()` que implemente `DataSeeder` (`kind`, `order`, `run()` idempotente). El `SeederRunner` lo descubre solo.

```ts
@Injectable()
@Seeder()
export class SourceCatalogSeeder implements DataSeeder {
  readonly kind = 'catalog';
  readonly order = 10;
  async run(): Promise<void> {
    // upsert: volver a correrlo no duplica datos
  }
}
```

## Endpoints

Por el gateway: `http://localhost:8080/api/sds/**`. En dev también directo: `http://localhost:8084/api/sds/**`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` (directo, solo dev) | Respuesta básica *"Soluquim SDS API Service is running!"* (`IndexController`, como en Java). |
| `GET` | `/api/sds/v1/health/live` | Liveness (lo usa el healthcheck de Docker). |
| `GET` | `/api/sds/v1/health` | Readiness: BD propia + RabbitMQ. `503` si algo está caído. |
| `GET` | `/api/sds/v1/substances/{cas}?refresh=false` | Una sustancia en **todas las fuentes**. |
| `GET` | `/api/sds/v1/mixtures/lookup?components=64-17-5:70,7732-18-5:30` | Una **mezcla** por query string (`cas:porcentaje` separados por coma). Sirve para probar desde el navegador. |
| `POST` | `/api/sds/v1/mixtures/lookup` | Lo mismo con body JSON: `{ "components": [{ "cas": "64-17-5", "percentage": 70 }, …], "refresh": false }`. |
| `GET` | `/api/sds/v1/sources` | Fuentes: cuáles hay, cuáles están activas y su estado (circuito, pausa). |
| `POST` | `/api/sds/v1/knowledge/sync` | **Deja al día datos + RAG** de un CAS o de los componentes de una mezcla. Body: `{ "cas": "64-17-5" }` o `{ "components": [{ "cas": … }], "refresh": false }`. |
| `GET` | `/api/sds/v1/knowledge/search?cas=…&sections=4,5&q=…` | Busca en la base de conocimiento (lo mismo que ve el agente). |
| `POST` | `/api/sds/v1/knowledge/{cas}/reindex` | Reconstruye el RAG de un CAS desde sus datos guardados. |
| `POST` | `/api/sds/v1/generations` | **Genera el borrador de la FDS con IA** (asíncrono). Responde `202 { jobId }`. `503` si falta la clave de IA. |
| `GET` | `/api/sds/v1/generations/{jobId}` | Estado del job: `QUEUED → EXTRACTING → DRAFTING → COMPLETED / PARTIAL / FAILED`, con `documentId`, tokens y costo. |
| `GET` | `/api/sds/v1/documents/{id}` | La FDS: por cada sección, la sugerencia del agente **y** lo que encontró cada fuente. |
| `GET` | `/api/sds/v1/reference-documents?scope=LIBRARY\|PRODUCT&ids=…` | Documentos subidos (biblioteca de referencia o documentos del producto), con su estado de vectorización. |
| `GET` | `/api/sds/v1/reference-documents/options` | Extensiones admitidas, tamaño máximo y categorías (las de la biblioteca y las de un documento del producto). |
| `POST` | `/api/sds/v1/reference-documents` | Sube un documento (multipart: `file`, `title`, `category`, `language`, `sdsSections`, `scope`, `cas`). `202`: se vectoriza en el worker. |
| `PATCH` | `/api/sds/v1/reference-documents/{id}` | Cambia sus datos (título, categoría, idioma, secciones). |
| `DELETE` | `/api/sds/v1/reference-documents/{id}` | Lo borra con sus fragmentos. |
| `POST` | `/api/sds/v1/reference-documents/{id}/reindex` | Vuelve a extraer el texto y a vectorizarlo. |
| `GET` | `/api/sds/v1/reference-documents/{id}/file` | Descarga el archivo original. |

Swagger: http://localhost:8084/api/sds/docs (o http://localhost:8080/api/sds/docs por el gateway), y en el Swagger UI centralizado del gateway (`http://localhost:8080/swagger-ui.html`, entrada **sds**).

Toda respuesta usa el sobre estándar de Soluquim: `{ timestamp, status, message, data }`. Los errores de validación devuelven `422` con `data = { campo: mensaje }`, igual que los micros Java.

### Sustancia: `GET /substances/{cas}`

- **Validación del CAS**: formato `NNNNNNN-NN-N` y **dígito verificador**. Ej.: `64-17-4` → `422`.
- **Respuesta**: `cas`, `name`, `iupacName`, `molecularFormula`, `synonyms` y, por cada fuente, `sources[]` con `status` (`OK` / `NOT_FOUND` / `FAILED` / `CIRCUIT_OPEN`), `fromCache`, `stale`, `retrievedAt`, `expiresAt`, `sourceUrl` y `records[]`.
  - Cada `record` tiene un `field` normalizado (`identity.*`, `physical.*`, `exposure.*`, `ghs.classifications`…), un `label`, un `value` y la `sourceUrl` exacta de donde salió.
- **Status HTTP**:
  - `200` si al menos una fuente tiene datos (si alguna falló, lo dicen el `message` y `summary`).
  - `404` si ninguna fuente tiene la sustancia.
  - `502` si no se pudo consultar ninguna fuente.
- `refresh=true` ignora el caché y vuelve a consultar.

### Mezcla: `GET|POST /mixtures/lookup`

- **Validación**:
  - De 1 a 50 componentes, cada uno con un CAS válido y un porcentaje mayor que 0 y hasta 100.
  - La suma no puede superar 100 % → `422` con el total.
- **Normalización**:
  - Los CAS repetidos se suman y se avisa en `warnings`.
  - Los porcentajes se redondean a 4 decimales y se ordenan de mayor a menor.
  - Si la suma es menor a 100, se avisa cuánto falta declarar.
- **Respuesta**: `totalPercentage`, `warnings`, `summary` (`FOUND` / `PARTIAL` / `NOT_FOUND` / `UNAVAILABLE`) y `components[]`, cada uno con su `substance`, que tiene el mismo formato que la consulta de una sustancia. Un componente que falla no tumba la consulta.

## Fuentes de datos

Todas se consultan **a la vez, en paralelo**, por cada CAS. `GET /api/sds/v1/sources` muestra cuáles hay, cuáles están activas y su estado en vivo (circuito, pausa). Cuáles se consultan lo decide `SOURCES_ENABLED` en `soluquim-api-sds/.env`: `*` son las activas por defecto, o se pasa una lista de códigos.

| Código | Fuente | Tipo | Qué aporta (sección FDS) | Caché |
|---|---|---|---|---|
| `PUBCHEM` | PubChem (NIH) | API JSON | Identidad, clasificaciones SGA y el registro completo que agrega HSDB, CAMEO, Haz-Map y EPA: propiedades experimentales, primeros auxilios y tratamiento médico, incendio, vertidos, eliminación, reactividad, DL50, ecotoxicidad, biodegradación y designación de transporte (1 a 14) | 30 d |
| `ECHA` | ECHA CHEM — C&L Inventory | API JSON | **Clasificación armonizada CLP** con límites de concentración específicos (SCL), **factores M y ETA**, más la notificada dominante (2, 3, 11, 12, 15) | 30 d |
| `ICSC` | Fichas Internacionales de Seguridad Química (OIT/OMS) | HTML | **En español**: incendio, primeros auxilios por vía, derrames, almacenamiento, SGA, ONU, propiedades, salud y medio ambiente (2, 4–12, 14) | 90 d |
| `NIOSH_NPG` | NIOSH Pocket Guide (CDC) | HTML | REL, PEL, IDLH, propiedades, primeros auxilios, EPP y ONU (4, 8, 9, 10, 14) | 90 d |
| `INSST_LEP` | INSST — Límites de Exposición Profesional (España) | HTML | VLA-ED y VLA-EC oficiales, notas VLB/VLI (8, 15) | 90 d |
| `COMPTOX` | EPA CompTox Dashboard | API JSON | Propiedades experimentales y predichas; DL50/CL50 por vía y especie (9, 11) | 60 d |
| `IARC` | IARC Monographs (OMS) | Dataset | Grupo de carcinogenicidad 1/2A/2B/3. El listado completo se baja una vez por semana (11) | 30 d |
| `NIST` | NIST Chemistry WebBook (SRD 69) | HTML | Constantes termodinámicas con referencia (K y °C) (9) | 180 d |
| `OSHA` | OSHA Occupational Chemical Database | HTML, **background** | PEL, REL, ACGIH TLV© y Cal/OSHA, IDLH, carcinógenos (8, 11). **Apagada por defecto**, ver abajo | 90 d |

**Fuentes del plan que NO se integran, y por qué:**
- **GESTIS (IFA/DGUV):** sus términos prohíben el uso comercial y transferir los datos a otros sistemas, y el detalle requiere un token. Solo se puede enlazar o pedir una licencia a IFA.
- **Límites internacionales IFA (ILV):** sus términos prohíben explícitamente scrapers, bots y minería de datos.
- **eChemPortal (OCDE):** sus datos son los de ECHA REACH, que ya se consulta. No aporta datos nuevos.
- **Buscatox:** es un directorio de enlaces, sin datos propios. Lo reemplaza **INSST LEP**, con los límites oficiales en español.
- **OSHA**, implementada pero apagada: osha.gov responde 403 a clientes que no se presentan como navegador. Hacerse pasar por uno sería evadir su bloqueo, así que no se hace. Se activa con `SOURCES_ENABLED=...,OSHA` si OSHA habilita el acceso.

**Términos de uso que se respetan:**
- ECHA permite consultas puntuales citando la fuente, no la extracción masiva: caché largo, pocas consultas simultáneas y `meta.attribution` en cada respuesta.
- NIST tiene copyright SRD: se cita.
- ICSC: © OIT/OMS, se cita.
- ACGIH TLV© se marca con su copyright.

**Fuentes lentas (modo `background`):** si una fuente con `mode: 'background'` (hoy solo OSHA) no está en caché, la respuesta HTTP no la espera:
- Devuelve `PENDING`, o el dato viejo marcado `stale` si había.
- Publica la tarea `sds.source.fetch` en RabbitMQ.
- El worker la consulta respetando su pausa obligatoria (10 s entre peticiones) y la deja en caché para la próxima consulta.
- Los encargos repetidos se descartan.

**Cómo funciona la consulta** (`CollectSubstanceDataService`, patrón *cache-aside*):
1. Si hay un dato vigente en la BD propia (OK o NOT_FOUND), se devuelve sin llamar a la fuente.
2. Si no, se consulta. OK y NOT_FOUND se guardan con su vencimiento, y la respuesta cruda queda en `raw_snapshots` (gzip). Con eso se puede auditar y volver a parsear sin llamar de nuevo a la fuente.
3. Si la fuente falla y había un dato bueno, se devuelve ese dato con `stale: true` y el error (*stale-if-error*). Los fallos no se cachean.
4. Las fuentes se consultan en paralelo. Si llegan dos pedidos del mismo CAS a la vez, comparten la misma consulta (*single-flight*).
5. **Identidad**: PubChem manda. NIOSH solo completa los campos vacíos.

**Resiliencia por fuente** (`BaseSourceProvider` + `cockatiel`): límite de llamadas simultáneas, circuit breaker, reintentos con backoff exponencial y timeout por intento.
- Un "no encontrado" o un 4xx no se reintentan.
- Si la fuente responde con `Retry-After` (PubChem lo hace cuando limita), el proveedor **se pausa ese tiempo y no la llama**: devuelve `CIRCUIT_OPEN` al instante, porque insistir solo alarga el bloqueo.

**Agregar una fuente nueva**:
1. Crear `modules/source/provider/<Fuente>SourceProvider.ts` que extienda `BaseSourceProvider`, con `code`, `cacheTtlDays` y `performFetch(cas, signal)`, más su parser puro en `modules/source/parser/`.
2. Agregar el código a `SourceCodeEnum`.
3. Registrarlo en `SourceProviderRegistry` y en `SourceModule`.
4. Escribir el test del parser con un fixture real en `test/fixtures/sources/<fuente>/`.

Nada más cambia: el caché, la API y las mezclas lo toman solos.

## Estructura

Sigue la estructura normativa de backend ([docs/guidelines/backend.md](../docs/guidelines/backend.md)): `modules/` (negocio) + `shared/` (técnico, sin negocio).

```
src/
├── main.api.ts          # proceso HTTP
├── main.worker.ts       # proceso worker (arranca el dispatcher)
├── AppModule.ts
├── controller/          # IndexController (GET /)
├── modules/
│   ├── source/          # adaptadores a las fuentes externas (no guarda nada)
│   │   ├── base/        #   BaseSourceProvider (Template Method + resiliencia)
│   │   ├── provider/    #   PubChemSourceProvider, NioshNpgSourceProvider
│   │   ├── parser/      #   parsers PUROS (JSON / HTML) → SourceRecord[]
│   │   ├── registry/    #   SourceProviderRegistry (fuentes activas)
│   │   └── dto/ enums/ exception/
│   ├── substance/       # sustancia por CAS + cache por fuente (módulo compuesto)
│   │   ├── substance/            # GET /substances/{cas}
│   │   └── substancesourcedata/  # CollectSubstanceDataService (cache-aside), snapshots
│   ├── reference/       # documentos subidos: biblioteca de referencia y documentos del producto
│   │   ├── extractor/   #   texto por tipo de archivo (PDF, DOCX); registro extensible (Excel…)
│   │   ├── chunker/     #   texto → fragmentos, detecta la sección de la FDS de cada uno (puro)
│   │   ├── repository/  #   reference_documents + reference_chunks (búsqueda vectorial + CAS/ONU)
│   │   └── service/     #   Upload, Index (worker), contexto de la biblioteca y de los documentos del producto
│   ├── knowledge/       # base de conocimiento del agente (RAG sobre pgvector)
│   │   ├── catalog/     #   las 16 secciones de la FDS + qué campo alimenta cuál
│   │   ├── chunker/     #   datos de una fuente → fragmentos etiquetados (puro)
│   │   ├── repository/  #   knowledge_chunks + búsqueda vectorial (SQL)
│   │   └── service/     #   Sync (datos + RAG al día), Index, Search
│   └── sds/             # FDS (módulo compuesto)
│       ├── sdsmixture/     #   GET|POST /mixtures/lookup, MixtureNormalizer
│       ├── sdsgeneration/  #   job asíncrono + agente redactor (agent/, prompt/, validator/, assembler/)
│       └── sdsdocument/    #   el borrador de la FDS guardado
└── shared/
    ├── ai/              # IA genérica: contract/ (LlmProvider, EmbeddingProvider), provider/openrouter/,
    │                    #   factory/ (AiProviderFactory), agent/ (BaseAgent, AgentSettings)
    ├── annotation/      # @RequirePermission
    ├── base/            # BaseService
    ├── config/          # env.schema (Zod) + AppConfig tipado
    ├── context/         # headers del gateway → RequestContext (AsyncLocalStorage)
    ├── exception/       # BusinessException, ValidationException, HttpExceptionFilter
    ├── guard/           # PermissionGuard (misma regla que PermissionInterceptor de Java)
    ├── health/          # /health + tarea sds.ping
    ├── http/            # ResultInterceptor, ZodValidationPipe
    ├── logging/         # pino (JSON) con requestId/tenantId/userId en cada línea
    ├── messaging/       # RabbitMQ compatible con soluquim-commons
    ├── persistence/     # PrismaService
    ├── resilience/      # timeout + retry + circuit breaker + bulkhead (cockatiel)
    ├── seed/            # @Seeder + SeederRunner (APP_SEED_ENABLED / APP_SEED_DEMO)
    ├── util/            # Result, sobre de respuesta
    └── validation/      # validador de CAS (formato + dígito verificador)
```

### Convenciones

- **Imports y exports siempre con `@/`**, nunca con `./` ni `../`. ESLint lo rechaza.
- **Cada carpeta tiene un `index.ts`** que expone todo lo que contiene, y desde afuera se importa de ahí: `import { Result } from '@/shared/util';`.
  - Única excepción: dentro de la **misma** carpeta se importa el archivo (`@/shared/config/AppConfig`), no el propio `index.ts`. Así se evitan ciclos que rompen la inyección de dependencias de Nest.
- **Fronteras entre módulos**: ESLint (`eslint-plugin-boundaries`) aplica el grafo de §7.2 del plan. `shared` no importa de `modules`, y no hay ciclos.
- **Un archivo = una clase**, en PascalCase (`RequestSdsGenerationService.ts`). Un caso de uso por service, con método `execute()` que devuelve un `Result`.
- **Controllers**: retornan el `Result` del service y nunca usan `@Res()`. El `ResultInterceptor` arma el status y el sobre.
- **Permisos**: `@RequirePermission('sds:documents:view')` en el controller o en el método. Se aceptan `*`, el permiso exacto o `sds:*`.

## Datos, base de conocimiento e IA

### Siempre la base local primero (y versionado)

`SyncSubstanceKnowledgeService` es **el** punto de entrada para "tener la información de estas sustancias". Recibe un CAS o los componentes de una mezcla y lo usan la generación de la FDS, el endpoint `POST /knowledge/sync` y, más adelante, el cron que recorrerá los productos:

1. **BD primero**: si hay un dato vigente de la fuente, no se la llama.
2. **Fuente solo si falta o venció** (o con `refresh: true`, que es lo que usará el cron para detectar cambios).
3. **Versionado**: `substance_source_data` guarda la versión **vigente** (una por CAS + fuente). Si la fuente trae lo mismo (`content_hash`), solo se renueva el vencimiento. Si trae algo distinto, la versión vigente pasa a `substance_source_data_history` con su rango `valid_from → valid_to` y se escribe la nueva (`version + 1`).
4. **RAG**: los datos se parten en fragmentos por tema, etiquetados con las secciones de la FDS que alimentan, y se guardan en `knowledge_chunks` con su vector (`pgvector`, índice HNSW). **Solo se vectoriza lo nuevo o lo que cambió.** Repetir el sync sin cambios no llama al proveedor de embeddings.

### Generación de la FDS con el agente

```
POST /generations ──► job (QUEUED) ──► RabbitMQ ──► worker
   1. SyncSubstanceKnowledgeService   datos + RAG al día de cada componente
   2. Por cada grupo de secciones (6 grupos, en paralelo):
        BuildSectionContextService    TODO el conocimiento vigente de todas las fuentes de cada componente,
                                      priorizado: núcleo → fragmentos de esas secciones → resto por similitud
        SdsSectionDraftingAgent       redacta SOLO con ese contexto y cita cada dato (K1, K2…)
        SectionSuggestionBuilder      arma la sección con la PLANTILLA (SdsSectionCatalog): campo sin dato = null,
                                      valor sin cita válida = descartado, citas inventadas informadas
   3. Documento (DRAFT) con las 16 secciones:
        filledBy   → request (sección 1: solo lo que mandó el usuario), agent (2 a 15) o system (16)
        suggestion → subsections[{code,title,fields[{key,label,value,origin,citations,pictograms?}]}],
                     siempre los mismos apartados y campos; además content (texto), missingData, discarded…
        bySource  → lo que encontró CADA fuente para esa sección (sin IA)
```

`bySource` es lo que le permite al usuario **quitar o cambiar** algo de la sugerencia del agente por el dato de la fuente que prefiera.

Revisión (lo que usa el módulo FDS de la web app):
- `GET /documents?limit=` — FDS recientes (resumen).
- `PATCH /documents/:id/sections/:number/fields/:key` — cambia un campo: `{ value }` (texto del revisor, `origin: user`) o `{ value, source: { source, cas } }` (dato tomado de una fuente de esa sección, `origin: source`, queda como cita). `value: null` lo deja vacío. Devuelve la sección recalculada.

Reglas del agente (están en su prompt):
- Plantilla cerrada: solo llena los campos de cada apartado; no agrega campos ni texto de más.
- No inventa: campo sin dato en las fuentes queda `null` ("Sin datos disponibles") y aparece en `missingData`.
- La sección 1 nunca pasa por la IA: por ahora solo nombre y CAS del producto, de la solicitud (`product.name`, `product.cas`); lo que no se mandó queda vacío.
- Idioma: todo sale en el `language` pedido, venga la fuente en el idioma que venga (códigos, números y siglas no se traducen).
- Campos con forma propia (`kind`): `pictograms` → `[{code, name}]` (la imagen la pone el front por código); `statements` (frases H/P/EUH) → `[{code, text}]` con el texto oficial en español de `GhsStatementCatalog`; `signalWord` en el idioma de la ficha.
- Mezclas: la etiqueta (2.2) reúne los elementos de todos los componentes y la clasificación queda "pendiente del cálculo SGA"; 3.1 solo existe para sustancias y 3.2 solo para mezclas.
- Sin IA: sección 15 (`RegulatorySectionBuilder`, volcado de ECHA/INSST/IARC/ICSC citado) y sección 16 (fecha, texto íntegro de las frases H, fuentes).
- Especialistas (`agent/prompt/SdsSpecialistProfiles`): cada grupo de secciones se redacta con el criterio de su especialista (clasificación SGA, emergencias, higiene industrial, fisicoquímica, toxicología/ecotoxicología, residuos y transporte). Para afinar una sección se edita su `guidance` y se sube `PROMPT_VERSION`.
- Dos pasadas por grupo: la 2.ª (`GapReviewPlanner`) vuelve a preguntar SOLO por los campos que quedaron vacíos, con los fragmentos propios de esas secciones.
- Si el modelo repite una sección en varias entradas, se unen (`SectionSuggestionBuilder.mergeDrafts`); las referencias `[K3]` y el nombre de la sustancia antepuesto se limpian del texto.
- Mezclas: a un componente sin clasificación de peligro (agua; `ComponentHazardProfile.isInert`) no se le pasa conocimiento al agente fuera de las secciones 2 y 3, ni entra en la 15.
- Sección 11 (`ClassificationEndpointFiller`): cada clase de peligro que quede vacía dice lo que establece la clasificación armonizada (la clase y su H, o "no clasificado para este peligro"), citado a ECHA.
- Cada grupo tiene un tiempo límite (240 s): si se pasa, ese grupo falla y la FDS sale PARTIAL con lo que traen las fuentes. Un job "en curso" por más de 15 min se marca FAILED al consultarlo.
- Red de seguridad (`SourceFallbackFiller`): un campo que el agente dejó vacío y que una fuente trae tal cual se llena con el dato de la fuente (`origin: source`); si la llamada del agente falla, la sección se arma igual con lo que traen las fuentes.
- Copia los valores numéricos con su unidad y su jurisdicción.
- Ante fuentes que no coinciden, elige la opción más conservadora y lo registra en `conflicts`.
- **No calcula la clasificación de una mezcla**: presenta la de cada componente y la deja "pendiente del cálculo SGA", que es la Fase 3.

Si un grupo de secciones falla, la FDS sale `PARTIAL`: esas secciones quedan sin sugerencia, pero con sus datos de las fuentes.

### Documentación de referencia y documentos del producto

Dos tipos de documento subido, en las mismas tablas (`reference_documents`, `reference_chunks`) y por el mismo endpoint, distinguidos por `scope`:

| | Biblioteca (`LIBRARY`) | Documentos del producto (`PRODUCT`) |
|---|---|---|
| Qué es | SGA (Libro Púrpura), GRE, Manual de Pruebas y Criterios, procedimientos (TR-P-01), páginas de interés… | FDS del proveedor de cada materia prima (con su `cas`), FDS de productos análogos, datos del producto final (certificado de análisis, ficha técnica, requisitos del cliente), otros. |
| Dónde se sube | Web: FDS → pestaña "Documentación complementaria". | Web: formulario "Nueva FDS" → "Documentos del producto": una o varias FDS por componente y uno o varios archivos por tipo. |
| Quién lo usa | **Toda** generación. | Solo la generación que lo adjunta (`documentIds` en `POST /generations`). |
| En la FDS se cita como | `R1, R2…` → fuente `REFERENCE` | `D1, D2…` → fuente `PRODUCT_DOCUMENT` |

- **Indexación**: al subir, el worker extrae el texto (`DocumentTextExtractorRegistry`: hoy PDF y DOCX; otro formato = otro extractor registrado), lo parte en fragmentos y los vectoriza. En una FDS, cada fragmento queda etiquetado con su sección (1–16) leyendo los encabezados ("SECCIÓN 9", "9. Propiedades…").
- **Duplicados**: el mismo archivo en la biblioteca da `409`. Como documento del producto se reutiliza el existente (mismo hash y CAS).
- **Búsqueda**: semántica y, además, por identificadores (CAS, número ONU) para no perder la ficha exacta de la GRE o la entrada de la Lista de Mercancías Peligrosas.
- **Documentos del producto en la generación**: si alguno no está listo, el job lo procesa antes de redactar (hasta 180 s). Para cada grupo de secciones toma primero los fragmentos de esas secciones de cada documento y reparte el presupuesto por turnos entre documentos. Orden: datos del producto final → FDS de proveedores → análogos.

Reglas del agente para estos documentos (prompt v11, reglas 15–23):
- Los datos de la FDS de un proveedor valen como datos de **ese componente** y se atribuyen a él por su nombre.
- Una FDS análoga **solo** sirve de modelo de redacción de las medidas (primeros auxilios, incendio, derrames, manipulación, protección, eliminación). Nunca para las secciones 2, 9, 11 o 12 ni para el grupo de embalaje: su composición casi nunca es la misma.
- Los datos del producto final tienen prioridad en la sección 9.
- Si un documento contradice a una fuente oficial (ECHA, Lista de Mercancías Peligrosas), prima la oficial y queda en `conflicts`.
- **Mezclas y concentraciones** (`MixtureConcentrationProfile`): el agente recibe por componente cada clase de peligro, el límite que le aplica (el específico de ECHA o el genérico del SGA) y si su % lo alcanza. En Colombia se usan los límites inferiores (p. ej. Repr. 2 ≥ 0,1 %).
- Sección 9 (`MixturePropertyFilter`): los valores de un componente minoritario (< 50 %) se descartan si hay uno mayoritario.

**Redacción por etapas** (`AI_STAGED_DRAFTING`, TR-P-01 Anexo 1): primero clasificación, fisicoquímica y toxicología; después emergencias, higiene industrial, residuos y transporte, con lo ya redactado como `<prior_sections>` para que la ficha sea coherente.

**País de destino** (`country/CountryRegulatoryProfile`): con `destinationCountry: "CO"`, el agente aplica la revisión del SGA, el orden de los límites de exposición (ACGIH → NIOSH → OSHA) y la normativa de residuos. La sección 15 lista la normativa nacional (Decreto 1496/2018, Res. 0773/2021), citada como `COUNTRY_PROFILE`.

| Variable (`soluquim-api-sds/.env`) | Qué es | Por defecto |
|---|---|---|
| `AI_REFERENCE_CONTEXT_MAX_CHARS` | Texto de la biblioteca por llamada al agente | `16000` |
| `AI_PRODUCT_DOCUMENTS_CONTEXT_MAX_CHARS` | Texto de documentos del producto por grupo de secciones | `24000` |
| `AI_STAGED_DRAFTING` | Redacción por etapas (`false` = todo en paralelo) | `true` |
| `AI_LLM_MAX_CONCURRENCY` | Llamadas simultáneas al LLM por proceso | `3` |
| `REFERENCE_MAX_UPLOAD_MB` | Tamaño máximo de un archivo subido | `50` |

### Elegir o cambiar de modelo con datos

`scripts/eval-drafting-models.js` corre el **agente real** (mismo RAG, prompt y validación) sobre un solo grupo de secciones contra los modelos que se le pasen. Informa costo, tiempo, si el JSON valida, citas inventadas y faltantes, y guarda el texto para leerlo. Cada llamada cuesta alrededor de un centavo.

```bash
docker compose exec sds node scripts/eval-drafting-models.js "google/gemini-2.5-flash,google/gemini-3.1-flash-lite" 50-00-0 4,5,6
```

Resultado de la evaluación inicial (formaldehído, secciones 4 a 6):

| Modelo | Resultado |
|---|---|
| `google/gemini-2.5-flash` | **Elegido.** El más fiel a las fuentes: escribe "no se especifica" en vez de rellenar. |
| `google/gemini-3.1-flash-lite` | Más barato y rápido, algo menos fiel. |
| `qwen/qwen3.7-plus` | Válido, pero tarda 88 s. |
| `deepseek/deepseek-v4-pro` | Dejó el texto de la sección vacío. |
| `anthropic/claude-sonnet-5.5` | Máxima calidad, unas 8 veces más caro. No se evaluó. |

El contexto por llamada se limita con `AI_CONTEXT_MAX_CHARS` (60 000 por defecto, unos 15 000 tokens). Se reparte entre los componentes de la mezcla.

### Proveedor y modelos: solo `.env`

Todo se configura en el **`.env` raíz de soluquim-docker**, bloque **"IA COMPARTIDA"**. Son las mismas variables para cualquier micro que use IA; hoy solo las consume este servicio.

| Variable | Qué es | Valor por defecto |
|---|---|---|
| `AI_PROVIDER` | Proveedor | `openrouter` |
| `OPENROUTER_API_KEY` | Clave. Vacía = IA apagada (el resto del servicio funciona). | — |
| `AI_LLM_MODEL` | Modelo de los agentes | `google/gemini-2.5-flash` (~US$ 0,06 por FDS, medido) |
| `AI_EMBEDDING_MODEL` / `AI_EMBEDDING_DIMENSIONS` | Embeddings del RAG. La dimensión **debe** coincidir con `vector(1536)` de la BD. | `openai/text-embedding-3-small` / `1536` |
| `SDS_AI_AGENT_MODELS` | Modelo distinto para un agente: `agente=modelo` | — |

Las peticiones salen con `data_collection: deny`: OpenRouter solo enruta a proveedores que no guardan ni entrenan con los datos.

| Quiero… | Qué toco |
|---|---|
| Cambiar el modelo | `AI_LLM_MODEL` en el `.env` raíz + `make sds-restart`. |
| Otro modelo solo para un agente | `SDS_AI_AGENT_MODELS=sds-section-drafting=deepseek/deepseek-v4-pro`. |
| Cambiar de proveedor | Implementar `LlmProvider` y `EmbeddingProvider` en `shared/ai/provider/<nombre>/`, registrarlo en `AiProviderFactory` y poner `AI_PROVIDER=<nombre>`. Los agentes no cambian. |
| Editar el agente | `modules/sds/sdsgeneration/agent/prompt/` y subir `PROMPT_VERSION`, que queda guardada en cada FDS. |
| Crear otro agente | Una clase que extienda `BaseAgent` en su módulo, con `name`, `promptVersion`, `outputSchema` y `buildMessages`. |
| Cambiar el modelo de embeddings por uno de otra dimensión | Migración de la columna `vector(N)` y re-vectorizar: `POST /knowledge/{cas}/reindex`. |

Estructura de la IA:
- `shared/ai/`: genérico, no sabe de FDS. Contratos (`contract/`), adaptador de OpenRouter (`provider/`), `factory/` y `agent/BaseAgent`. `BaseAgent` pide la salida estructurada, la valida con Zod y reintenta una vez si no valida.
- `modules/knowledge/`: el RAG. Catálogo de secciones, chunker, repositorio vectorial, indexación, búsqueda y sync.
- `modules/sds/sdsgeneration/`: el agente redactor, su prompt, el job y el armado. `modules/sds/sdsdocument/`: el documento.

## Mensajería (RabbitMQ)

Misma topología y formato que `soluquim-commons`:

- Publica en el exchange `soluquim.tasks` (topic); la routing key es el `taskType`.
- Cola propia `soluquim.sds.tasks.q`, enlazada a `sds.#`, con DLX `soluquim.tasks.dlx` y DLQ `soluquim.tasks.dlq`.
- El sobre JSON es idéntico a `AsyncTaskEnvelope` / `MessageContext` de Java, con header `__TypeId__`. Hay un test de contrato: [AsyncTaskEnvelope.spec.ts](test/unit/shared/messaging/AsyncTaskEnvelope.spec.ts).
- Errores:
  - Sobre inválido, sin handler o payload que no valida → DLQ sin reintentar.
  - El handler lanza error → 3 intentos con backoff exponencial (2 s, ×2, máx. 10 s) → DLQ.

**Publicar una tarea** (desde un service):

```ts
await this.publisher.publish('sds.generation.requested', { jobId });   // AsyncTaskPublisher de @/shared/messaging
```

**Consumir una tarea**: un provider con `@TaskHandler()` que implemente `AsyncTaskHandler`. El dispatcher lo descubre solo.

```ts
@Injectable()
@TaskHandler()
export class SdsGenerationRequestedHandler implements AsyncTaskHandler<{ jobId: string }> {
  readonly taskType = 'sds.generation.requested';
  readonly payloadSchema = z.object({ jobId: z.uuid() });

  async handle({ jobId }: { jobId: string }): Promise<void> {
    // debe ser IDEMPOTENTE: el mismo mensaje puede llegar más de una vez
  }
}
```

**Eventos WebSocket**: `WsRelayPublisher.publish(userId, type, payload)` publica `ws.relay`, que entrega api-auth. El `type` **tiene que existir** en el enum Java `WebSocketEventType` de soluquim-commons. Si no existe, el mensaje termina en la DLQ.

**Prueba de punta a punta**: publicar `sds.ping` en `soluquim.tasks`, por ejemplo desde la consola de RabbitMQ en `:15672`, con este payload:

```json
{"taskType":"sds.ping","payload":{"message":"hola"},"context":{"tenantId":"12","userId":"7","email":null,"username":"ana","roles":[]},"messageId":"m-1","occurredAt":"2026-10-02T15:58:00Z"}
```

En `make logs-sds` aparece: `pong — message="hola" tenant=12 user=7`.

## Base de datos

- Esquema en [prisma/schema.prisma](prisma/schema.prisma), migraciones en `prisma/migrations/`.
- Las referencias a datos de otros servicios (tenant, usuario, país, producto) se guardan como valor, sin FK, porque viven en otra base.
- Flujo para cambiar el modelo: editar `schema.prisma` → `make sds-migration NAME=descripcion` → commitear la carpeta de la migración. En QA/Prod la aplica `sds-migrate` en el siguiente despliegue.

## Desarrollo local sin Docker (opcional)

```bash
npm ci
npm run typecheck && npm run lint && npm test
```

Para correr la app fuera de Docker hay que exportar `DATABASE_URL` y `RABBITMQ_URL` apuntando a los puertos publicados (`localhost:5439` y `localhost:5672`). Lo normal es usar siempre el contenedor.
