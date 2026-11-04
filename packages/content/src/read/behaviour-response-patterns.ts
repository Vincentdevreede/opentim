/** Complete compiler forms of the velocity limiter and conditional contact sound request. */
export const clampPatterns = [
  `push bp
mov bp,sp
sub sp,#4
push si
mov si,16:ss[bp+6]
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-2],#{tableSegment}
mov 16:ss[bp+-4],ax
les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
cmp ax,16:ds[si+56]
jge @labelAQ
jmp @labelAX
labelAQ: les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
cmp ax,16:ds[si+56]
jle @labelAY
xor ax,ax
sub ax,16:es[bx+10]
labelAX: mov 16:ds[si+56],ax
labelAY: les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
cmp ax,16:ds[si+54]
jge @labelBD
jmp @labelBK
labelBD: les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
cmp ax,16:ds[si+54]
jle @labelBL
xor ax,ax
sub ax,16:es[bx+10]
labelBK: mov 16:ds[si+54],ax
labelBL: pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#4
push si
mov si,16:ss[bp+6]
mov ax,16:ds[si+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov 16:ss[bp+-2],#{tableSegment}
mov 16:ss[bp+-4],ax
les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
cmp ax,16:ds[si+56]
jge @labelAT
les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
mov 16:ds[si+56],ax
jmp @labelBC
labelAT: les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
cmp ax,16:ds[si+56]
jle @labelBC
les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
mov 16:ds[si+56],ax
labelBC: les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
cmp ax,16:ds[si+54]
jge @labelBK
les bx,32:ss[bp+-4]
mov ax,16:es[bx+10]
mov 16:ds[si+54],ax
jmp @labelBT
labelBK: les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
cmp ax,16:ds[si+54]
jle @labelBT
les bx,32:ss[bp+-4]
xor ax,ax
sub ax,16:es[bx+10]
mov 16:ds[si+54],ax
labelBT: pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
push si
push di
mov di,16:ss[bp+6]
mov ax,16:ds[di+4]
mov dx,#58
imul dx
add ax,#{tableOffset}
mov cx,ax
mov ax,16:ds[di+56]
mov bx,cx
cmp ax,16:ds[bx+10]
jle @labelAS
mov bx,cx
mov ax,16:ds[bx+10]
mov 16:ds[di+56],ax
jmp @labelBB
labelAS: mov bx,cx
xor ax,ax
sub ax,16:ds[bx+10]
cmp 16:ds[di+56],ax
jge @labelBB
mov bx,cx
xor ax,ax
sub ax,16:ds[bx+10]
mov 16:ds[di+56],ax
labelBB: mov ax,16:ds[di+54]
mov bx,cx
cmp ax,16:ds[bx+10]
jle @labelBJ
mov bx,cx
mov ax,16:ds[bx+10]
mov 16:ds[di+54],ax
jmp @labelBS
labelBJ: mov bx,cx
xor ax,ax
sub ax,16:ds[bx+10]
cmp 16:ds[di+54],ax
jge @labelBS
mov bx,cx
xor ax,ax
sub ax,16:ds[bx+10]
mov 16:ds[di+54],ax
labelBS: pop di
pop si
pop bp
retf`,
];
export const soundPatterns = [
  `push bp
mov bp,sp
sub sp,#2
push si
mov si,16:ss[bp+6]
cmp 16:ds[si+4],#0
jne @labelBB
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ds[si+56]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
mov 16:ss[bp+-2],dx
cmp 16:ss[bp+-2],#4096
jle @labelBB
mov ax,#20
push ax
nop
push cs
call $sound
pop cx
labelBB: pop si
mov sp,bp
pop bp
retf`,
  `push bp
mov bp,sp
sub sp,#2
push si
mov si,16:ss[bp+6]
cmp 16:ds[si+4],#0
jne @labelAZ
mov ax,16:ds[si+54]
cwd
xor ax,dx
sub ax,dx
push ax
mov ax,16:ds[si+56]
cwd
xor ax,dx
sub ax,dx
pop dx
add dx,ax
mov 16:ss[bp+-2],dx
cmp 16:ss[bp+-2],#4096
jle @labelAZ
mov ax,#20
push ax
callf $sound
pop cx
labelAZ: pop si
mov sp,bp
pop bp
retf`,
];
