import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import ProductOrder from '../server/models/ProductOrder.js';
import { lookupPincode, normalizeIndiaState, normalizePincode } from '../server/utils/indiaPincode.js';
import { orderAddress, orderContact, phonePeProductStatus } from '../server/routes/orders.js';

test('India pincode utilities normalize known and prefix-inferred pincodes', () => {
  assert.equal(normalizePincode('400 001'), '400001');
  assert.equal(normalizePincode('12345'), '');
  assert.equal(normalizeIndiaState('maharashtra'), 'Maharashtra');
  assert.deepEqual(lookupPincode('560001'), {
    pincode: '560001',
    serviceable: true,
    city: 'Bengaluru',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    country: 'India'
  });
  assert.equal(lookupPincode('110099').state, 'Delhi');
});

test('product checkout contact and address validation returns normalized values', () => {
  assert.deepEqual(orderContact({
    fullName: '  Zoher   Shakir  ',
    mobile: '98765 43210'
  }), {
    fullName: 'Zoher Shakir',
    mobile: '+919876543210',
    email: ''
  });

  assert.deepEqual(orderAddress({
    houseStreet: '  12 Test Street ',
    area: ' Vijay Nagar ',
    landmark: ' Near Metro ',
    city: '',
    state: '',
    pincode: '452001'
  }), {
    houseStreet: '12 Test Street',
    area: 'Vijay Nagar',
    landmark: 'Near Metro',
    city: 'Indore',
    district: 'Indore',
    state: 'Madhya Pradesh',
    pincode: '452001',
    country: 'India'
  });

  assert.equal(orderContact({ fullName: 'A', mobile: '9876543210', email: 'bad' }).email, '');
  assert.throws(() => orderContact({ fullName: 'A', mobile: '12345' }), /valid Indian mobile/);
  assert.throws(() => orderAddress({ houseStreet: 'A', city: 'X', state: 'Delhi', pincode: '000000' }), /not serviceable/);
});

test('ProductOrder validates required checkout fields and serializes client payloads', () => {
  const productId = new mongoose.Types.ObjectId();
  const order = new ProductOrder({
    items: [{
      product: productId,
      name: 'Demo Shirt',
      brand: 'Lookmefy',
      category: 'Shirts',
      imageUrl: '/uploads/demo.jpg',
      quantity: 2,
      unitPrice: 499,
      lineTotal: 998,
      currency: 'INR'
    }],
    contact: {
      fullName: 'Zoher Shakir',
      mobile: '+919876543210'
    },
    address: {
      houseStreet: '12 Test Street',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452001',
      country: 'India'
    },
    subtotal: 998,
    deliveryFee: 0,
    total: 998,
    currency: 'INR',
    merchantOrderId: 'LFPO_TEST'
  });

  assert.equal(order.validateSync(), undefined);
  const client = order.toClient();
  assert.equal(client.items[0].productId, productId.toString());
  assert.equal(client.items[0].quantity, 2);
  assert.equal(client.total, 998);
  assert.equal(client.paymentMode, 'demo');
  assert.equal(client.paymentStatus, 'created');
  assert.equal(client.fulfillmentStatus, 'new');

  const invalid = new ProductOrder({ items: [], subtotal: 0, total: 0 });
  assert.match(String(invalid.validateSync()), /contact.fullName/);
});

test('product PhonePe state mapping keeps paid, pending, and failed states separate', () => {
  assert.equal(phonePeProductStatus('COMPLETED'), 'paid');
  assert.equal(phonePeProductStatus('PENDING'), 'pending');
  assert.equal(phonePeProductStatus('FAILED'), 'failed');
  assert.equal(phonePeProductStatus('TIMED_OUT'), 'failed');
  assert.equal(phonePeProductStatus('UNKNOWN'), '');
});
