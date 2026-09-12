import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/wordpress-checkout.js',import.meta.url),'utf8');
test('WordPress relay rejects untrusted origin, frame, and checkout URL',()=>{
 let listener;const navigations=[];const frameWindow={};
 vm.runInNewContext(source,{URL,window:{addEventListener:(_,fn)=>listener=fn,location:{assign:url=>navigations.push(url)}},document:{getElementById:()=>({contentWindow:frameWindow})}});
 const valid={origin:'https://ancienne-ecole-troche.netlify.app',source:frameWindow,data:{aeSource:'ae-booking-embed',type:'ae-checkout',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_example'}};
 listener({...valid,origin:'https://attacker.example'});listener({...valid,source:{}});
 for(const checkoutUrl of ['https://checkout.stripe.com.attacker.example/', 'https://attacker.example/', 'javascript:alert(1)', 'https://user:pass@checkout.stripe.com/', 'invalid'])listener({...valid,data:{...valid.data,checkoutUrl}});
 assert.deepEqual(navigations,[]);listener(valid);assert.deepEqual(navigations,[valid.data.checkoutUrl]);
});
