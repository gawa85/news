# Prueba con lectores de pantalla

Las pruebas automáticas (axe) encuentran cerca de un tercio de los problemas de accesibilidad. El resto sólo aparece usando la web como la usa una persona ciega o con baja visión. Esta guía es para hacer esa prueba en una hora, sin experiencia previa.

## Qué usar

| Equipo | Lector | Navegador | Cómo se activa |
|---|---|---|---|
| Windows | **NVDA** (gratis, nvaccess.org) | Firefox o Chrome | `Ctrl + Alt + N` |
| Celular Android | **TalkBack** (viene instalado) | Chrome | Ajustes → Accesibilidad → TalkBack |
| iPhone | **VoiceOver** (viene instalado) | Safari | Ajustes → Accesibilidad → VoiceOver (o triple clic en el botón lateral) |

Si nunca los usaste, dedicá 10 minutos al tutorial de cada uno (NVDA: menú Ayuda → Guía de inicio rápido; TalkBack y VoiceOver tienen uno al activarlos).

### Teclas de NVDA que vas a usar

| Tecla | Qué hace |
|---|---|
| `Tab` / `Shift + Tab` | Siguiente / anterior control (link, botón, campo) |
| `H` / `1` | Siguiente título / título principal |
| `D` | Siguiente región (encabezado, navegación, contenido) |
| `F` | Siguiente campo de formulario |
| `Insert + F7` | Lista de links, títulos y regiones |
| `Insert + Espacio` | Cambia entre "leer" y "escribir en un campo" |
| `Ctrl` | Calla la lectura |

En el celular: deslizar a la derecha / izquierda = siguiente / anterior; doble toque = activar.

## Cómo anotar

Para cada tarea: **¿se pudo hacer?** (sí / con dificultad / no), **qué dijo el lector** en el momento del problema (copialo tal cual) y **qué esperabas**. Un problema = una fila. Mandá la tabla por /ayuda o como issue.

| Pantalla | Tarea | Resultado | Qué dijo el lector | Qué esperabas |
|---|---|---|---|---|
| | | | | |

## Tareas (en orden)

Hacelas **sin mirar la pantalla** (bajá el brillo al mínimo o tapala). Anotá también el tiempo aproximado de cada una.

### 1. Entrar (`/entrar`)
1. Al cargar, ¿el lector dice el título de la página («Entrar a Sin Humo»)?
2. Con `Tab`, ¿se llega al campo «Tu mail» y se entiende qué pedir?
3. Pedí el enlace. ¿Se anuncia «Revisá tu mail» sin tener que buscarlo?
4. Probá con un mail mal escrito: ¿se entiende el error?
5. Pestaña «Con contraseña»: ¿se anuncia como pestaña y cuál está elegida?

### 2. Analizar (`/analizar`)
1. Pegá una cadena (o usá «Probar con un ejemplo»).
2. Al terminar, ¿el lector va solo al resultado y lo lee?
3. ¿Se entiende el índice de humo **sin ver la barra**? (debe decir el número y «Casi todo humo», etc.)
4. ¿Se puede recorrer cada «humo» encontrado y su explicación?
5. Botones «¿Te sirvió?»: ¿se anuncia qué hacen?

### 3. Comparar fuentes (`/comparar`) y Credibilidad (`/credibilidad`)
1. ¿Se completan tema y fechas con el teclado? ¿Las sugerencias de temas se pueden elegir?
2. En credibilidad, **Ver la evolución**: ¿la tabla se lee por filas y columnas (`Ctrl + Alt + flechas` en NVDA)? ¿Se entiende la tendencia sin el gráfico?

### 4. ¿Quién lo dijo primero? (`/origen`)
1. Pegá un link. Si pide el tema, ¿se anuncia el campo nuevo?
2. En la cadena de notas, ¿se entiende cuál es la primera y cuáles son «casi copia»?

### 5. Salas del equipo (`/salas`) y eventos en vivo (`/eventos`)
1. Con otra persona escribiendo en la sala: ¿los mensajes nuevos se anuncian **sin sacarte del campo donde estás escribiendo**?
2. ¿Se anuncia quién escribió cada mensaje?
3. ¿Se puede borrar un mensaje propio con el teclado y confirmar?

### 6. Mi cuenta (`/cuenta`) y organización (`/organizacion`)
1. Cambiá el formato de respuesta y guardá: ¿se anuncia que se guardó?
2. Cancelá el plan (si es pago) y después «Seguir»: ¿se entiende hasta cuándo sigue?
3. Invitá a alguien: ¿se entiende el rol elegido y la confirmación?

### 7. Juego «¿Esto es humo?» (`/jugar`)
1. Respondé tres preguntas. ¿Se anuncia si acertaste y la explicación?

### 8. Celular
Repetí las tareas 1, 2 y 5 con TalkBack o VoiceOver. Además:
- ¿Se puede agrandar el texto al 200 % (Ajustes → Tamaño de letra) sin que nada se corte ni se superponga?
- ¿Los botones son fáciles de tocar?

## Qué es grave

- **Bloqueante**: no se puede terminar una tarea (un botón que no se alcanza, un resultado que no se lee, quedar atrapado en un control).
- **Serio**: se puede, pero con mucho esfuerzo o adivinando (un botón que se anuncia sólo como «botón», un error que no se anuncia).
- **Menor**: molesto pero claro (lectura repetida, orden raro).

Los bloqueantes se arreglan antes de publicar.

## Quiénes deberían probar

Lo ideal es que la prueba la hagan **personas que usan lectores de pantalla todos los días** (no sólo el equipo): sus hábitos son distintos a los de alguien que lo usa por primera vez. En Argentina se puede contactar a organizaciones como la Biblioteca Argentina para Ciegos o Tiflonexos. Pagales el tiempo como a cualquier prueba con usuarios.
