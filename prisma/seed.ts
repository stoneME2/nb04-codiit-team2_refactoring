import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const grades = [
    { id: 'grade_vip', name: 'vip', minAmount: 1000000, rate: 0.1 },
    { id: 'grade_black', name: 'black', minAmount: 500000, rate: 0.07 },
    { id: 'grade_red', name: 'red', minAmount: 300000, rate: 0.05 },
    { id: 'grade_orange', name: 'orange', minAmount: 100000, rate: 0.03 },
    { id: 'grade_green', name: 'green', minAmount: 0, rate: 0.01 },
  ];

  const categories = [
    { name: 'top' },
    { name: 'bottom' },
    { name: 'dress' },
    { name: 'outer' },
    { name: 'skirt' },
    { name: 'shoes' },
    { name: 'acc' },
  ];

  const sizes = [
    { id: 1, en: 'XS', ko: '엑스스몰' },
    { id: 2, en: 'S', ko: '스몰' },
    { id: 3, en: 'M', ko: '미디엄' },
    { id: 4, en: 'L', ko: '라지' },
    { id: 5, en: 'XL', ko: '엑스라지' },
    { id: 6, en: 'Free', ko: '프리' },
  ];

  // Grade 시딩
  for (const grade of grades) {
    await prisma.grade.upsert({
      where: { id: grade.id },
      update: {},
      create: grade,
    });
  }
  console.log('✅ Grade 시드 데이터 완료');

  // Category 시딩
  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: { name: category.name },
    });
  }
  console.log('✅ 카테고리 시딩 완료!');

  // Size 시딩
  for (const size of sizes) {
    await prisma.size.upsert({
      where: { id: size.id },
      update: {},
      create: {
        id: size.id,
        en: size.en,
        ko: size.ko,
      },
    });
  }
  console.log('✅ 사이즈 시딩 완료!');

  // 테스트 계정 시딩 (로컬/개발 환경용)
  const hashedPassword = await bcrypt.hash('test1234', 10);

  const testUsers = [
    {
      email: 'buyer@codiit.com',
      password: hashedPassword,
      name: '테스트구매자',
      type: 'BUYER' as const,
      gradeId: 'grade_green',
    },
    {
      email: 'seller@codiit.com',
      password: hashedPassword,
      name: '테스트판매자',
      type: 'SELLER' as const,
      gradeId: 'grade_green',
    },
  ];

  for (const user of testUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        password: user.password, // 강제 리셋
        name: user.name,
      },
      create: user,
    });
  }
  console.log('✅ 테스트 계정 시딩 완료!');

  // 테스트 스토어 시딩
  const seller = await prisma.user.findUnique({ where: { email: 'seller@codiit.com' } });
  if (!seller) throw new Error('판매자 계정이 없습니다.');

  const store = await prisma.store.upsert({
    where: { userId: seller.id },
    update: {},
    create: {
      name: '테스트스토어',
      content: '부하테스트용 스토어입니다.',
      address: '서울시 강남구',
      phoneNumber: '010-1234-5678',
      userId: seller.id,
    },
  });
  console.log('✅ 테스트 스토어 시딩 완료!');

  // 테스트 상품 시딩
  const topCategory = await prisma.category.findUnique({ where: { name: 'top' } });
  const bottomCategory = await prisma.category.findUnique({ where: { name: 'bottom' } });
  if (!topCategory || !bottomCategory) throw new Error('카테고리가 없습니다.');

  const testProducts = [
    { name: '테스트 티셔츠 A', price: 29000, image: 'https://placehold.co/300', categoryId: topCategory.id },
    { name: '테스트 티셔츠 B', price: 35000, image: 'https://placehold.co/300', categoryId: topCategory.id },
    { name: '테스트 바지 A', price: 45000, image: 'https://placehold.co/300', categoryId: bottomCategory.id },
    { name: '테스트 바지 B', price: 52000, image: 'https://placehold.co/300', categoryId: bottomCategory.id },
    { name: '테스트 티셔츠 C', price: 19000, image: 'https://placehold.co/300', categoryId: topCategory.id },
  ];

  for (const product of testProducts) {
    const existing = await prisma.product.findFirst({
      where: { name: product.name, storeId: store.id },
    });
    if (!existing) {
      await prisma.product.create({
        data: { ...product, storeId: store.id },
      });
    }
  }
  console.log('✅ 테스트 상품 5개 시딩 완료!');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
