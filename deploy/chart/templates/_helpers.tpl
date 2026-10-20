{{- define "realworld.labels" -}}
app.kubernetes.io/name: realworld-api
app.kubernetes.io/part-of: realworld
app.kubernetes.io/version: {{ .Values.revision | trunc 12 | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
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
