const test=require('node:test'); const assert=require('node:assert/strict');
const {ProductMatcher}=require('../packages/catalog-engine/src/productMatcher');
const {SynonymService}=require('../packages/catalog-engine/src/synonymService');
const {AttributeExtractor}=require('../packages/catalog-engine/src/attributeExtractor');
const matcher=new ProductMatcher({synonymService:new SynonymService(),attributeExtractor:new AttributeExtractor()});
const products=[
 {id:'pen',name:'Gel Pen Pack',aliases:['gel pens'],description:'Smooth-writing gel pen pack with five pens',category:'stationery',tags:[],inStock:true,colors:['Black','Blue'],sizes:[]},
 {id:'bottle',name:'Steel Water Bottle',aliases:['steel bottle'],description:'Reusable stainless steel water bottle',category:'home',tags:[],inStock:true,colors:[],sizes:[]},
 {id:'lamp',name:'LED Desk Lamp',aliases:['desk lamp'],description:'Adjustable LED desk lamp',category:'home',tags:[],inStock:true,colors:[],sizes:[]}
];
test('exact catalog product still resolves',()=>assert.equal(matcher.search('led desk lamp',products,{}).product?.id,'lamp'));
test('fountain pen never substitutes gel pen',()=>assert.equal(matcher.search('do you have fountain pen',products,{}).product,null));
test('ball point pen never substitutes gel pen',()=>assert.equal(matcher.search('ball point pen',products,{}).product,null));
test('plastic bottle never substitutes steel bottle',()=>assert.equal(matcher.search('i want plastic water bottle',products,{}).product,null));
test('gel pen still resolves',()=>assert.equal(matcher.search('gel pen',products,{}).product?.id,'pen'));
test('steel water bottle still resolves',()=>assert.equal(matcher.search('steel water bottle',products,{}).product?.id,'bottle'));
