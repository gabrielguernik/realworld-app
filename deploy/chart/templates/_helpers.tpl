{{/*
Labels of every object. Call with the root context, or with (dict "ctx" . "name" ... "component" ...).
The migration Job and its pod are named realworld-migrate, so the API's selector (name: realworld-api) never
matches them.
*/}}
{{- define "realworld.labels" -}}
{{- $ctx := .ctx | default . -}}
app.kubernetes.io/name: {{ .name | default "realworld-api" }}
app.kubernetes.io/part-of: realworld
app.kubernetes.io/version: {{ $ctx.Values.revision | trunc 12 | quote }}
app.kubernetes.io/managed-by: {{ $ctx.Release.Service }}
{{- with .component }}
app.kubernetes.io/component: {{ . }}
{{- end }}
{{- end }}

{{/* TLS options of every DATABASE_URL: verify the RDS root CA baked into the image (Dockerfile, /app/certs). */}}
{{- define "realworld.dbTls" -}}
sslmode=require&sslcert=/app/certs/rds-ca.pem&sslaccept=strict
{{- end }}

{{- define "realworld.selector" -}}
app.kubernetes.io/name: realworld-api
{{- end }}

{{- define "realworld.tag" -}}
{{- required "revision (or image.tag) is required" (.Values.image.tag | default .Values.revision) -}}
{{- end }}

{{/* Restricted Pod Security Standard, shared by the API and the migration Job. */}}
{{- define "realworld.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end }}
